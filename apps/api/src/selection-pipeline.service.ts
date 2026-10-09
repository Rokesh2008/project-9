import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { ClassificationService } from './member1/classification/classification.service';
import { EligibilityService } from './member1/eligibility/eligibility.service';
import { RankingService } from './member1/ranking/ranking.service';
import { ScoringService } from './member1/scoring/scoring.service';
import { WeightsService } from './member1/weights/weights.service';
import { SelectionRulesService } from './selection-rules/selection-rules.service';
import { SELECTION_DEMO_CODE, SELECTION_DEMO_PREFIX } from './selection-demo.fixture';
import { runBulkSelection } from './selection-pipeline.bulk';
import type { SelectionCycle } from '@prisma/client';

@Injectable()
export class SelectionPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weights: WeightsService,
    private readonly scoring: ScoringService,
    private readonly eligibility: EligibilityService,
    private readonly ranking: RankingService,
    private readonly classification: ClassificationService,
    @Optional() private readonly customRules?: SelectionRulesService,
  ) {}

  private async assertDemoCycle(id: string) {
    const rows = await this.prisma.$queryRaw<Array<{cycle:SelectionCycle;members:Array<{studentId:string;student:{studentId:string;name:string;attendancePercent:number|null;cycleStatuses:Array<{selectionCycleId:string}>}}>;}>>`
      SELECT to_jsonb(c) AS cycle,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('studentId',m."studentId",'student',jsonb_build_object('studentId',s."studentId",'name',s.name,'attendancePercent',s."attendancePercent",'cycleStatuses',
          (SELECT jsonb_agg(jsonb_build_object('selectionCycleId',other."selectionCycleId")) FROM "StudentCycleStatus" other WHERE other."studentId"=s.id))))
        FROM "StudentCycleStatus" m JOIN "Student" s ON s.id=m."studentId" WHERE m."selectionCycleId"=c.id),'[]'::jsonb) AS members
      FROM "SelectionCycle" c WHERE c.id=${id}
    `;
    const cycle = rows[0]?.cycle;
    if (!cycle || cycle.code !== SELECTION_DEMO_CODE) throw new BadRequestException('Only the isolated synthetic demo cycle is allowed');
    const members = rows[0].members;
    if (members.length !== 6 || members.some(m => !m.student.studentId.startsWith(SELECTION_DEMO_PREFIX) || m.student.cycleStatuses.some(s => s.selectionCycleId !== id))) throw new BadRequestException('Demo isolation check failed');
    return { cycle, members };
  }

  async runDemo(id: string, actor: string) {
    await this.assertDemoCycle(id);
    return this.run(id, actor);
  }

  async demoStatus(id: string) {
    const { cycle, members } = await this.assertDemoCycle(id);
    const [scores, rankings, eligibility, classifications] = await Promise.all([
      this.prisma.assessmentResult.findMany({ where: { studentId: { in: members.map(m => m.studentId) } } }),
      this.prisma.studentRanking.findMany({ where: { selectionCycleId: id } }),
      this.prisma.eligibilityResult.findMany({ where: { selectionCycleId: id } }),
      this.prisma.hopePepClassification.findMany({ where: { selectionCycleId: id } }),
    ]);
    return { cycle, students: members.map(m => {
      const rank = rankings.find(r => r.studentId === m.studentId);
      const eligible = eligibility.find(e => e.studentId === m.studentId);
      const classification = classifications.find(c => c.studentId === m.studentId);
      return { studentId: m.student.studentId, name: m.student.name, attendance: m.student.attendancePercent, coding: scores.find(s => s.studentId === m.studentId && s.assessmentType === 'CODING')?.score, aptitude: scores.find(s => s.studentId === m.studentId && s.assessmentType === 'APTITUDE')?.score, totalScore: rank?.totalScore ?? null, rank: rank?.rank ?? null, baselineEligible: eligible?.isEligible ?? null, baselineFailures: eligible?.failedRules ?? null, program: classification?.program ?? 'NOT_RUN', customEligibility: classification?.customEligibility ?? null, evaluatedAt: classification?.classifiedAt ?? null };
    }).sort((a,b) => a.studentId.localeCompare(b.studentId)) };
  }

  async run(selectionCycleId: string, actorId: string) {
    return runBulkSelection(this.prisma, selectionCycleId, actorId, !!this.customRules);
  }

  /** Reference implementation retained for regression comparison, never routed. */
  private async runLegacy(selectionCycleId: string, actorId: string) {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');
    if (cycle.status === 'FROZEN') {
      throw new BadRequestException('Frozen cycles cannot run the live selection pipeline');
    }

    const activeWeights = await this.weights.getActiveVersion(selectionCycleId);
    if (!activeWeights) {
      throw new BadRequestException(
        'An active weight version must be configured before running selection',
      );
    }

    const cycleStudents = await this.prisma.studentCycleStatus.findMany({
      where: { selectionCycleId },
      select: { studentId: true },
    });
    if (cycleStudents.length === 0) {
      return {
        selectionCycleId,
        scored: 0,
        eligibilityEvaluated: 0,
        ranked: 0,
        classified: 0,
        results: [],
      };
    }

    let scored = 0;
    const missingInputs: Array<{ studentId: string; parameters: string[] }> = [];

    for (const item of cycleStudents) {
      const inputs = await this.parameterInputs(
        item.studentId,
        activeWeights.weights.map((weight) => weight.parameterKey),
      );

      const missing = inputs
        .filter((input) => input.rawScore === null || input.rawScore === undefined)
        .map((input) => input.parameterKey);
      if (missing.length) {
        missingInputs.push({ studentId: item.studentId, parameters: missing });
      }

      await this.scoring.calculateStudentScores(
        selectionCycleId,
        item.studentId,
        inputs,
        actorId,
      );
      scored++;
    }

    const eligibility = await this.eligibility.evaluate(
      selectionCycleId,
      undefined,
      actorId,
      undefined,
      cycleStudents.map(item => item.studentId),
    );
    const ranking = await this.ranking.calculate(
      selectionCycleId,
      activeWeights.id,
      actorId,
    );
    const classification = await this.classification.calculate(
      selectionCycleId,
      actorId,
    );

    await this.syncWorkflowStates(selectionCycleId, classification, actorId);

    const selected = classification.filter(
      (item) => item.program === 'HOPE' || item.program === 'PEP',
    );
    const waitlisted = classification.filter(
      (item) => item.program === 'WAITLIST',
    );
    const ineligible = classification.filter(
      (item) => item.program === 'NOT_ELIGIBLE',
    );

    return {
      selectionCycleId,
      weightVersionId: activeWeights.id,
      scored,
      eligibilityEvaluated: eligibility.length,
      ranked: ranking.length,
      classified: classification.length,
      selected: selected.length,
      waitlisted: waitlisted.length,
      ineligible: ineligible.length,
      missingInputs,
      results: classification,
    };
  }

  private async syncWorkflowStates(
    selectionCycleId: string,
    classification: Array<{ studentId: string; program: string }>,
    actorId: string,
  ) {
    for (const item of classification) {
      const nextState =
        item.program === 'HOPE' || item.program === 'PEP'
          ? 'COMMUNICATION'
          : item.program === 'WAITLIST'
            ? 'HOPE_PEP'
            : 'ELIGIBILITY';

      const previous = await this.prisma.studentCycleStatus.findUnique({
        where: {
          studentId_selectionCycleId: {
            studentId: item.studentId,
            selectionCycleId,
          },
        },
      });

      if (previous?.currentState === nextState) continue;

      await this.prisma.$transaction(async (tx) => {
        const status = await tx.studentCycleStatus.upsert({
          where: {
            studentId_selectionCycleId: {
              studentId: item.studentId,
              selectionCycleId,
            },
          },
          update: { currentState: nextState },
          create: {
            studentId: item.studentId,
            selectionCycleId,
            currentState: nextState,
          },
        });

        await tx.workflowAuditLog.create({
          data: {
            studentCycleStatusId: status.id,
            studentId: item.studentId,
            selectionCycleId,
            fromState: previous?.currentState ?? 'IMPORTED',
            toState: nextState,
            actor: actorId,
            role: 'SYSTEM',
            reason: `Selection pipeline classified student as ${item.program}`,
            metadata: {
              source: 'SELECTION_PIPELINE',
              program: item.program,
            },
          },
        });
      });
    }
  }

  private async parameterInputs(studentId: string, parameterKeys: string[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        assessmentResults: true,
        credentials: { where: { verificationStatus: 'VERIFIED' } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    const highest = (type: string) => {
      const values = student.assessmentResults
        .filter((item) => item.assessmentType === type)
        .map((item) => item.score);
      return values.length ? Math.max(...values) : null;
    };

    const readiness = student.assessmentResults
      .filter((item) => {
        if (item.assessmentType !== 'OTHER') return false;
        const metadata = item.metadata as
          | { kind?: string }
          | null
          | undefined;
        return metadata?.kind === 'READINESS_SCORE';
      })
      .sort((a, b) => b.assessmentDate.getTime() - a.assessmentDate.getTime())[0]
      ?.score ?? null;

    const customContext = this.customRules ? await this.customRules.readinessContext(studentId) : {};
    return parameterKeys.map((parameterKey) => ({
      parameterKey,
      rawScore: (Object.prototype.hasOwnProperty.call(customContext, parameterKey) ? customContext[parameterKey] : this.resolveRawScore(parameterKey, {
        coding: highest('CODING'),
        aptitude: highest('APTITUDE'),
        communication: highest('COMMUNICATION'),
        interview: highest('INTERVIEW'),
        cgpa: student.cgpa,
        attendance: student.attendancePercent,
        readiness,
        certificateCount: student.credentials.length,
      })) as number | null,
    }));
  }

  private resolveRawScore(
    parameterKey: string,
    values: {
      coding: number | null;
      aptitude: number | null;
      communication: number | null;
      interview: number | null;
      cgpa: number | null;
      attendance: number | null;
      readiness: number | null;
      certificateCount: number;
    },
  ): number | null {
    const key = parameterKey.trim().toLowerCase().replaceAll(/[^a-z0-9]/g, '');

    const aliases: Record<string, number | null> = {
      coding: values.coding,
      codingscore: values.coding,
      aptitude: values.aptitude,
      aptitudescore: values.aptitude,
      communication: values.communication,
      communicationscore: values.communication,
      interview: values.interview,
      interviewscore: values.interview,
      cgpa: values.cgpa,
      attendance: values.attendance,
      attendancepercent: values.attendance,
      readiness: values.readiness,
      readinessscore: values.readiness,
      project2: values.readiness,
      project2score: values.readiness,
      certificatecount: values.certificateCount,
      certificates: values.certificateCount,
    };

    return Object.prototype.hasOwnProperty.call(aliases, key)
      ? aliases[key]
      : null;
  }
}
