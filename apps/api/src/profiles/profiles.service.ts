import { ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';
import { ReadinessService } from '../readiness/readiness.service';
import { Prisma } from '@prisma/client';

type Failure = { field?: string; operator?: string; actual?: unknown; expected?: unknown; message?: string };

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly readiness?: ReadinessService) {}

  async listForStaff(principal: AuthPrincipal, search = '', page = 1, sort = '') {
    this.assertStaff(principal);
    const query = search.trim().slice(0, 100);
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = 25;
    // One joined page query replaces the ORM's per-relation fetches. The
    // count runs concurrently; no assessment history or password is returned.
    const filter = Prisma.sql`s."isActive" = true AND (${query} = '' OR s."studentId" ILIKE ${`%${query}%`} OR s."registerNumber" ILIKE ${`%${query}%`} OR s."name" ILIKE ${`%${query}%`} OR u."loginIdentifier" ILIKE ${`%${query}%`})`;
    const order = sort==='readiness_asc' ? Prisma.sql`r."readinessScore" ASC NULLS LAST, s."studentId" ASC` : sort==='readiness_desc' ? Prisma.sql`r."readinessScore" DESC NULLS LAST, s."studentId" ASC` : Prisma.sql`s."studentId" ASC`;
    const [counts, students] = await Promise.all([
      this.prisma.$queryRaw<Array<{total:bigint}>>(Prisma.sql`SELECT count(*) AS total FROM "Student" s LEFT JOIN "User" u ON u."studentId"=s.id WHERE ${filter}`),
      this.prisma.$queryRaw<Array<{studentId:string;registerNumber:string|null;name:string;department:string;departmentName:string;batch:string;rollNumber:string|null;readinessScore:number|null;verificationStatus:string;trainingGroup:string|null;allocationStatus:string}>>(Prisma.sql`
        SELECT s."studentId", s."registerNumber", s.name, d.code AS department, d.name AS "departmentName", b."batchIdentifier" AS batch,
          u."loginIdentifier" AS "rollNumber", r."readinessScore", COALESCE(r."verificationStatus",'PENDING') AS "verificationStatus",
          COALESCE(a."domainName", ra."trainingGroup") AS "trainingGroup",
          COALESCE(a.status::text,CASE WHEN ra.id IS NOT NULL THEN 'EXISTING_ALLOCATION' ELSE 'NOT_ALLOCATED' END) AS "allocationStatus"
        FROM "Student" s JOIN "Batch" b ON b.id=s."batchId" JOIN "Department" d ON d.id=b."departmentId"
        LEFT JOIN "User" u ON u."studentId"=s.id LEFT JOIN "RosterAllocation" ra ON ra."studentId"=s.id
        LEFT JOIN LATERAL (SELECT "readinessScore","verificationStatus" FROM "ReadinessAssessment" WHERE "studentId"=s.id ORDER BY "assessedAt" DESC,"createdAt" DESC,id DESC LIMIT 1) r ON true
        LEFT JOIN LATERAL (SELECT a.status,d.name AS "domainName" FROM "Allocation" a LEFT JOIN "Domain" d ON d.id=a."domainId" WHERE a."studentId"=s.id ORDER BY a."createdAt" DESC LIMIT 1) a ON true
        WHERE ${filter} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(safePage-1)*pageSize}
      `),
    ]);
    return {total:Number(counts[0].total),page:safePage,pageSize,students};
  }

  /** ORM reference retained for equivalence tests; not used by HTTP routes. */
  private async listForStaffLegacy(principal: AuthPrincipal, search = '', page = 1, sort = '') {
    this.assertStaff(principal);
    const query = search.trim().slice(0, 100);
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = 25;
    const where = {
      isActive: true,
      ...(query ? {
        OR: [
          { studentId: { contains: query, mode: 'insensitive' as const } },
          { registerNumber: { contains: query, mode: 'insensitive' as const } },
          { name: { contains: query, mode: 'insensitive' as const } },
          { user: { is: { loginIdentifier: { contains: query, mode: 'insensitive' as const } } } },
        ],
      } : {}),
    };
    const readinessSort = sort === 'readiness_asc' || sort === 'readiness_desc';
    // Sort the complete matching population by each student's latest assessment
    // before pagination. Missing scores always follow numeric scores (including 0).
    const orderedIds = readinessSort ? await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT s."id" FROM "Student" s
      LEFT JOIN "User" u ON u."studentId" = s."id"
      LEFT JOIN LATERAL (
        SELECT r."readinessScore" FROM "ReadinessAssessment" r
        WHERE r."studentId" = s."id"
        ORDER BY r."assessedAt" DESC, r."createdAt" DESC, r."id" DESC LIMIT 1
      ) latest ON true
      WHERE s."isActive" = true AND (${query} = '' OR
        s."studentId" ILIKE ${`%${query}%`} OR
        s."registerNumber" ILIKE ${`%${query}%`} OR
        s."name" ILIKE ${`%${query}%`} OR
        u."loginIdentifier" ILIKE ${`%${query}%`})
      ORDER BY latest."readinessScore" ${sort === 'readiness_asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`} NULLS LAST, s."studentId" ASC
      LIMIT ${pageSize} OFFSET ${(safePage - 1) * pageSize}
    `) : null;
    const [total, students] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where: orderedIds ? { ...where, id: { in: orderedIds.map(row => row.id) } } : where,
        select: {
          id: true, studentId: true, registerNumber: true, name: true,
          batch: { select: { batchIdentifier: true, department: { select: { code: true, name: true } } } },
          user: { select: { loginIdentifier: true } },
          rosterAllocation: { select: { trainingGroup: true } },
          readinessAssessments: { orderBy: [{ assessedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { readinessScore: true, verificationStatus: true } },
          allocations: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, domain: { select: { name: true } } } },
        },
        orderBy: { studentId: 'asc' }, skip: orderedIds ? 0 : (safePage - 1) * pageSize, take: pageSize,
      }),
    ]);
    if (orderedIds) {
      const positions = new Map(orderedIds.map((row, index) => [row.id, index]));
      students.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
    }
    return {
      total, page: safePage, pageSize,
      students: students.map((student) => ({
        studentId: student.studentId, registerNumber: student.registerNumber,
        name: student.name, department: student.batch.department.code,
        departmentName: student.batch.department.name, batch: student.batch.batchIdentifier,
        rollNumber: student.user?.loginIdentifier ?? null,
        readinessScore: student.readinessAssessments[0]?.readinessScore ?? null,
        verificationStatus: student.readinessAssessments[0]?.verificationStatus ?? 'PENDING',
        trainingGroup: student.allocations[0]?.domain?.name ?? student.rosterAllocation?.trainingGroup ?? null,
        allocationStatus: student.allocations[0]?.status ?? (student.rosterAllocation ? 'EXISTING_ALLOCATION' : 'NOT_ALLOCATED'),
      })),
    };
  }

  async mine(principal: AuthPrincipal) {
    if (principal.role !== 'STUDENT' || !principal.studentId) {
      throw new ForbiddenException('A linked student account is required');
    }
    return this.profile(principal.studentId);
  }

  async rosterAllocations(principal: AuthPrincipal, search = '', page = 1, group = '') {
    this.assertStaff(principal);
    const query = search.trim().slice(0, 100);
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const pageSize = 25;
    const where = {
      student: { isActive: true, ...(query ? { OR: [
        { name: { contains: query, mode: 'insensitive' as const } },
        { registerNumber: { contains: query, mode: 'insensitive' as const } },
      ] } : {}) },
      ...(group ? { trainingGroup: group } : {}),
    };
    const [total, records, groups] = await Promise.all([
      this.prisma.rosterAllocation.count({ where }),
      this.prisma.rosterAllocation.findMany({ where,
        include: { student: { select: { studentId: true, registerNumber: true, name: true, batch: { select: { batchIdentifier: true, department: { select: { name: true } } } } } } },
        orderBy: { student: { registerNumber: 'asc' } }, skip: (safePage - 1) * pageSize, take: pageSize,
      }),
      this.prisma.rosterAllocation.groupBy({ by: ['trainingGroup'], where: { student: { isActive: true } }, _count: { _all: true }, orderBy: { trainingGroup: 'asc' } }),
    ]);
    return { total, page: safePage, pageSize, groups: groups.map(item => ({ name: item.trainingGroup, count: item._count._all })),
      records: records.map(record => ({ studentId: record.student.studentId, registerNumber: record.student.registerNumber,
        name: record.student.name, department: record.student.batch.department.name, academicBatch: record.student.batch.batchIdentifier,
        trainingGroup: record.trainingGroup, trainingLevel: record.trainingLevel, sourceFile: record.sourceFile, importedAt: record.importedAt })) };
  }

  async forStaff(externalStudentId: string, principal: AuthPrincipal) {
    this.assertStaff(principal);
    const student = await this.prisma.student.findUnique({ where: { studentId: externalStudentId } });
    if (!student) throw new NotFoundException('Student not found');
    return this.profile(student.id);
  }

  private assertStaff(principal: AuthPrincipal) {
    if (!['ADMIN', 'COORDINATOR', 'PEP_STAFF'].includes(principal.role)) {
      throw new UnauthorizedException('Staff access required');
    }
  }

  private async profile(internalStudentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: internalStudentId },
      include: { batch: { include: { department: true } }, rosterAllocation: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const [status, readiness, reported] = await Promise.all([
      this.prisma.studentCycleStatus.findFirst({
      where: { studentId: student.id, selectionCycle: { status: { not: 'DRAFT' } } },
      include: { selectionCycle: true },
      orderBy: { createdAt: 'desc' },
      }),
      (this.readiness ?? new ReadinessService(this.prisma)).forStudent(student.id),
      this.prisma.assessmentResult.findMany({
        where: { studentId: student.id, assessmentType: { in: ['COMMUNICATION', 'INTERVIEW'] } },
        orderBy: [{ assessmentDate: 'desc' }, { createdAt: 'desc' }],
        select: { assessmentType: true, score: true, maxScore: true, assessmentDate: true, sourceIdentifier: true, metadata: true },
      }),
    ]);
    const identity = {
      studentId: student.studentId, name: student.name,
      registerNumber: student.registerNumber, email: student.email,
      department: student.batch.department.name, batch: student.batch.batchIdentifier,
    };
    const roster = student.rosterAllocation;
    const seenTypes = new Set<string>();
    const externalScores = reported.filter(row => { if (seenTypes.has(row.assessmentType)) return false; seenTypes.add(row.assessmentType); return true; }).map(row => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return { type: row.assessmentType, score: row.score, maxScore: row.maxScore, assessedAt: row.assessmentDate,
        source: typeof meta.source === 'string' ? meta.source : row.assessmentType === 'COMMUNICATION' ? 'PROJECT_1' : 'PROJECT_8',
        imported: row.sourceIdentifier.startsWith('pull:'),
        originalScore: typeof meta.originalScore === 'number' ? meta.originalScore : null,
        originalMaxScore: typeof meta.originalMaxScore === 'number' ? meta.originalMaxScore : null };
    });
    const rosterAllocation = roster ? {
      trainingGroup: roster.trainingGroup, trainingLevel: roster.trainingLevel,
      sourceFile: roster.sourceFile, sourceSheet: roster.sourceSheet, importedAt: roster.importedAt,
    } : null;
    if (!status) {
      const assessment = Boolean(await this.prisma.assessmentResult.findFirst({ where: { studentId: student.id }, select: { id: true } })) || readiness.score !== null || readiness.parameters.some(parameter => parameter.rawScore !== null);
      return {
        student: identity, cycle: null, outcome: 'NOT_IN_CYCLE', rosterAllocation, readiness, externalScores,
        assessmentStatus: assessment ? 'AVAILABLE' : 'PENDING',
        reason: assessment
          ? 'Your student profile is ready, but selection-cycle enrollment is pending. No selection decision has been made.'
          : rosterAllocation
            ? 'Your existing training allocation has been imported from the college Excel roster. Assessment data is not available yet; no new eligibility, ranking or selection evaluation has been performed.'
            : 'Your student profile is ready. Assessment data is not available yet, so eligibility, ranking and selection have not been evaluated. You have not been marked as not selected.',
        nextSteps: assessment
          ? ['Wait for the coordinator to enroll your record in a selection cycle.']
          : [rosterAllocation ? `Follow the college training instructions for ${rosterAllocation.trainingGroup}.` : 'Check your name, register number and department; report any correction to your coordinator.', 'Wait for assessment dates and score uploads from the college.', 'Report any profile or training-allocation correction to your coordinator.'],
        timeline: [
          { label: rosterAllocation ? 'Profile & allocation imported' : 'Student profile created', state: 'DONE' },
          { label: 'Assessment data received', state: assessment ? 'DONE' : 'PENDING' },
          { label: 'Eligibility checked', state: 'PENDING' },
          { label: 'Scored and ranked', state: 'PENDING' },
          { label: 'HOPE / PEP classification', state: 'PENDING' },
          { label: 'Final allocation approval', state: 'PENDING' },
        ],
        preferences: [], scoreBreakdown: [],
      };
    }

    const cycleId = status.selectionCycleId;
    const [eligibility, ranking, classification, allocation, preferences, config] = await Promise.all([
      this.prisma.eligibilityResult.findUnique({ where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycleId } } }),
      this.prisma.studentRanking.findUnique({ where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycleId } } }),
      this.prisma.hopePepClassification.findUnique({ where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycleId } } }),
      this.prisma.allocation.findUnique({ where: { studentId_selectionCycleId: { studentId: student.id, selectionCycleId: cycleId } }, include: { domain: true, trainingBatch: true } }),
      this.prisma.studentPreference.findMany({ where: { studentId: student.id, selectionCycleId: cycleId }, orderBy: { preferenceRank: 'asc' }, include: { domain: true } }),
      this.prisma.cycleConfig.findUnique({ where: { selectionCycleId: cycleId } }),
    ]);
    const scores = ranking ? await this.prisma.studentScore.findMany({
      where: { studentId: student.id, selectionCycleId: cycleId, weightVersionId: ranking.weightVersionId },
      orderBy: { parameterKey: 'asc' },
    }) : [];

    const failures = Array.isArray(eligibility?.failedRules)
      ? eligibility.failedRules as Failure[] : [];
    const failedReasons = failures.map((failure) => this.failureMessage(failure));
    const selected = classification?.program === 'HOPE' || classification?.program === 'PEP';
    let outcome = 'IN_PROGRESS';
    let reason = 'Your selection record is being processed. No final decision is available yet.';
    let nextSteps = ['Check this page for updates as eligibility and ranking are completed.'];

    if (eligibility && !eligibility.isEligible) {
      outcome = 'NOT_ELIGIBLE';
      reason = failedReasons.length
        ? `Not selected because the eligibility criteria were not met: ${failedReasons.join('; ')}.`
        : 'Not selected because one or more eligibility criteria were not met.';
      nextSteps = this.failureNextSteps(failures);
    } else if (classification?.program === 'NOT_ELIGIBLE') {
      const custom = classification.customEligibility as Record<string, {results?: Array<{isEligible:boolean;name:string;failedRules?:Failure[]}>}> | null;
      const policies = Object.values(custom ?? {}).flatMap(p => p.results ?? []).filter(p => !p.isEligible);
      const customFailures = policies.flatMap(p => p.failedRules ?? []);
      failedReasons.push(...customFailures.map(f => this.failureMessage(f)));
      outcome = 'NOT_ELIGIBLE';
      reason = `You did not meet the selection rules for an available programme${policies.length ? `: ${[...new Set(policies.map(p => p.name))].join('; ')}` : ''}.`;
      nextSteps = customFailures.length ? this.failureNextSteps(customFailures) : ['Contact the selection coordinator to review your programme eligibility.'];
    } else if (classification?.program === 'WAITLIST') {
      outcome = 'WAITLISTED';
      reason = `You met the eligibility rules, but rank ${ranking?.rank ?? classification.rank} was outside the available ${config?.hopeCount ?? 0} HOPE and ${config?.pepCount ?? 0} PEP places in this cycle.`;
      nextSteps = ['Watch this portal for a vacancy or revised cycle result.', 'Ask the selection coordinator about the waitlist and the next cycle.'];
    } else if (selected) {
      outcome = allocation?.status === 'APPROVED' || allocation?.status === 'FROZEN' ? 'FINALIZED' : 'SELECTED_PENDING_APPROVAL';
      reason = `You met the eligibility rules and were placed in ${classification.program} at rank ${ranking?.rank ?? classification.rank}.`;
      if (allocation?.status === 'REJECTED') {
        outcome = 'ALLOCATION_REJECTED';
        reason += ` Your proposed domain allocation was rejected${allocation.failureReason ? `: ${allocation.failureReason}` : ''}; your program selection remains recorded.`;
        nextSteps = ['Contact the selection coordinator for a revised allocation or review.'];
      } else if (allocation?.status === 'MANUAL_REVIEW') {
        reason += ` ${allocation.failureReason ?? 'Your preferred domains need manual review'}.`;
        nextSteps = ['Ask your domain faculty to review the allocation requirements and available capacity.', 'Wait for an authorized allocation decision.'];
      } else if (outcome === 'FINALIZED') {
        nextSteps = [`Review your assigned domain${allocation?.domain ? `: ${allocation.domain.name}` : ''}.`, 'Follow the training-batch instructions from your coordinator.'];
      } else {
        nextSteps = ['Wait for the faculty or administrator to review the proposed domain allocation.', 'Check this page for a finalized decision.'];
      }
    }

    return {
      student: identity,
      readiness,
      externalScores,
      rosterAllocation,
      cycle: { id: cycleId, code: status.selectionCycle.code, name: status.selectionCycle.name, status: status.selectionCycle.status },
      workflowState: status.currentState,
      outcome, reason, failedReasons, nextSteps,
      eligibility: eligibility ? { isEligible: eligibility.isEligible, evaluatedAt: eligibility.evaluatedAt } : null,
      ranking: ranking ? { rank: ranking.rank, totalScore: ranking.totalScore, percentile: ranking.percentile } : null,
      classification: classification ? { program: classification.program, status: classification.status, classifiedAt: classification.classifiedAt } : null,
      allocation: allocation ? {
        status: allocation.status, domain: allocation.domain ? `${allocation.domain.code} ${allocation.domain.name}` : null,
        batch: allocation.trainingBatch?.batchName ?? null,
        failureReason: allocation.failureReason,
      } : null,
      preferences: preferences.map((p) => ({ rank: p.preferenceRank, domain: `${p.domain.code} ${p.domain.name}` })),
      scoreBreakdown: scores.map((s) => ({ parameter: s.parameterKey, rawScore: s.rawScore, weightedScore: s.weightedScore, isMissing: s.isMissing })),
      timeline: [
        { label: 'Imported into cycle', state: 'DONE' },
        { label: 'Eligibility checked', state: eligibility ? 'DONE' : 'PENDING' },
        { label: 'Scored and ranked', state: ranking ? 'DONE' : 'PENDING' },
        { label: 'HOPE / PEP classification', state: classification ? 'DONE' : 'PENDING' },
        { label: 'Domain allocation review', state: allocation ? 'DONE' : 'PENDING' },
        { label: 'Final approval', state: allocation && ['APPROVED', 'FROZEN'].includes(allocation.status) ? 'DONE' : 'PENDING' },
      ],
    };
  }

  private failureMessage(failure: Failure) {
    const label = failure.field === 'attendancePercent' ? 'Attendance' : failure.field === 'cgpa' ? 'CGPA' : failure.field ?? 'Criterion';
    if (typeof failure.actual === 'number' && typeof failure.expected === 'number') {
      const suffix = failure.field === 'attendancePercent' ? '%' : '';
      return `${label} ${failure.actual}${suffix} did not meet the required ${failure.expected}${suffix}`;
    }
    return failure.message ?? `${label} did not meet the required criterion`;
  }

  private failureNextSteps(failures: Failure[]) {
    const steps = failures.map((failure) => {
      if (failure.actual === null || failure.actual === undefined) return `Ask the assessment coordinator to supply or verify your ${failure.field ?? 'required'} data before the next evaluation.`;
      if (['LTE','LT','EQ','NEQ'].includes(failure.operator ?? '')) return `Review the ${failure.field} requirement (${failure.operator} ${String(failure.expected)}) with your selection coordinator.`;
      if (failure.field === 'attendancePercent') return 'Improve attendance to the configured minimum before the next evaluation.';
      if (failure.field === 'cgpa') return 'Improve your CGPA to the configured minimum before the next cycle.';
      if (failure.field?.toLowerCase().includes('score')) return `Review and improve your ${failure.field} before the next evaluation.`;
      return `Review the ${failure.field ?? 'eligibility'} requirement with the selection coordinator.`;
    });
    return [...new Set([...steps, 'If the underlying data is incorrect, request a correction from the selection coordinator.'])];
  }
}
