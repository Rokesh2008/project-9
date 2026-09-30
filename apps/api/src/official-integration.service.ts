import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './common/prisma.service';
import { Project1ResultsDto, Project2ImportDto, Project8ResultsDto } from './dto';
import { EligibilityService } from './member1/eligibility/eligibility.service';

@Injectable()
export class OfficialIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: EligibilityService,
  ) {}

  enabled() {
    return (
      (process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() === 'postgres' ||
      (process.env.OFFICIAL_PROJECTION ?? 'false').toLowerCase() === 'true'
    );
  }

  async importProject2(payload: Project2ImportDto) {
    if (!this.enabled()) return { mode: 'STANDALONE', projected: 0, warnings: [] };

    const cycleId = await this.resolveCycle(payload.selectionCycleId);
    const warnings: string[] = [];
    let projected = 0;

    for (const row of payload.records) {
      const departmentCode = row.department.trim().toUpperCase();
      const department = await this.prisma.department.upsert({
        where: { code: departmentCode },
        update: { name: row.department.trim() },
        create: { code: departmentCode, name: row.department.trim() },
      });

      const academicYear = row.academicYear?.trim() || 'UNSPECIFIED';
      const batchIdentifier =
        row.batchIdentifier?.trim() || `${departmentCode}-${academicYear}`;

      const batch = await this.prisma.batch.upsert({
        where: { batchIdentifier },
        update: {
          academicYear,
          departmentId: department.id,
          status: 'ACTIVE',
        },
        create: {
          batchIdentifier,
          academicYear,
          departmentId: department.id,
          status: 'ACTIVE',
        },
      });

      const sourceUpdatedAt = new Date(row.sourceUpdatedAt);
      const student = await this.prisma.student.upsert({
        where: { studentId: row.studentId },
        update: {
          registerNumber: row.registerNumber.trim().toUpperCase(),
          name: row.name.trim(),
          email: row.email ?? null,
          cgpa: row.cgpa,
          attendancePercent: row.attendancePercent,
          dsaLevel: row.dsaLevel,
          sourceUpdatedAt,
          batchId: batch.id,
          isActive: true,
        },
        create: {
          studentId: row.studentId,
          registerNumber: row.registerNumber.trim().toUpperCase(),
          name: row.name.trim(),
          email: row.email ?? null,
          cgpa: row.cgpa,
          attendancePercent: row.attendancePercent,
          dsaLevel: row.dsaLevel,
          sourceUpdatedAt,
          batchId: batch.id,
          isActive: true,
        },
      });

      await this.upsertAssessment(
        student.id,
        `${payload.sourceBatchId}:coding`,
        'CODING',
        row.codingScore,
        100,
        sourceUpdatedAt,
        { source: 'PROJECT_2', sourceBatchId: payload.sourceBatchId },
      );
      await this.upsertAssessment(
        student.id,
        `${payload.sourceBatchId}:aptitude`,
        'APTITUDE',
        row.aptitudeScore,
        100,
        sourceUpdatedAt,
        { source: 'PROJECT_2', sourceBatchId: payload.sourceBatchId },
      );

      if (row.readinessScore !== undefined) {
        await this.upsertAssessment(
          student.id,
          `${payload.sourceBatchId}:readiness`,
          'OTHER',
          row.readinessScore,
          250,
          sourceUpdatedAt,
          {
            source: 'PROJECT_2',
            sourceBatchId: payload.sourceBatchId,
            kind: 'READINESS_SCORE',
          },
        );
      }

      for (const certificate of row.completedCertificates) {
        const name = certificate.trim();
        if (!name) continue;
        const sourceIdentifier = `PROJECT_2:${row.studentId}:CERT:${name.toLowerCase()}`;
        await this.prisma.studentCredential.upsert({
          where: { sourceIdentifier },
          update: {
            name,
            verificationStatus: 'VERIFIED',
            verifiedBy: 'PROJECT_2',
            verifiedAt: sourceUpdatedAt,
          },
          create: {
            studentId: student.id,
            name,
            sourceIdentifier,
            verificationStatus: 'VERIFIED',
            verifiedBy: 'PROJECT_2',
            verifiedAt: sourceUpdatedAt,
            metadata: { sourceBatchId: payload.sourceBatchId },
          },
        });
      }

      if (cycleId) {
        await this.updateCycleState(
          student.id,
          cycleId,
          'IMPORTED',
          'PROJECT_2',
          'Student synchronized from Project 2',
        );

        for (let index = 0; index < row.preferences.length; index++) {
          const preference = row.preferences[index];
          const domain = await this.findDomain(preference);
          if (!domain) {
            warnings.push(
              `Unknown domain preference "${preference}" for student ${row.studentId}`,
            );
            continue;
          }

          await this.prisma.studentPreference.upsert({
            where: {
              studentId_selectionCycleId_preferenceRank: {
                studentId: student.id,
                selectionCycleId: cycleId,
                preferenceRank: index + 1,
              },
            },
            update: { domainId: domain.id },
            create: {
              studentId: student.id,
              selectionCycleId: cycleId,
              domainId: domain.id,
              preferenceRank: index + 1,
            },
          });
        }
      }

      projected++;
    }

    return {
      mode: 'OFFICIAL',
      projected,
      selectionCycleId: cycleId,
      warnings,
    };
  }

  async importProject1(payload: Project1ResultsDto) {
    if (!this.enabled()) return { mode: 'STANDALONE', projected: 0, warnings: [] };

    const cycleId = await this.resolveCycle(payload.selectionCycleId);
    const warnings: string[] = [];
    let projected = 0;
    let reEvaluated = 0;

    for (const row of payload.records) {
      const student = await this.prisma.student.findUnique({
        where: { studentId: row.studentId },
      });
      if (!student) {
        warnings.push(`Unknown official student ${row.studentId}`);
        continue;
      }

      const previousAttempts = await this.prisma.assessmentResult.count({
        where: { studentId: student.id, assessmentType: 'COMMUNICATION' },
      });

      await this.prisma.assessmentResult.upsert({
        where: {
          studentId_sourceIdentifier: {
            studentId: student.id,
            sourceIdentifier: row.resultId,
          },
        },
        update: {
          score: row.score,
          maxScore: 100,
          percentage: row.score,
          assessmentDate: new Date(row.assessedAt),
          metadata: {
            source: 'PROJECT_1',
            level: row.level,
            sourceBatchId: payload.sourceBatchId,
          },
        },
        create: {
          studentId: student.id,
          sourceIdentifier: row.resultId,
          assessmentType: 'COMMUNICATION',
          score: row.score,
          maxScore: 100,
          percentage: row.score,
          attemptNumber: previousAttempts + 1,
          assessmentDate: new Date(row.assessedAt),
          metadata: {
            source: 'PROJECT_1',
            level: row.level,
            sourceBatchId: payload.sourceBatchId,
          },
        },
      });

      if (cycleId) {
        try {
          const result = await this.eligibility.evaluate(
            cycleId,
            undefined,
            'PROJECT_1',
            student.id,
          );
          const eligible = result[0]?.isEligible ?? false;
          await this.updateCycleState(
            student.id,
            cycleId,
            eligible ? 'INTERVIEW' : 'COMMUNICATION',
            'PROJECT_1',
            eligible
              ? 'Communication assessment passed; student is interview eligible'
              : 'Communication assessment did not satisfy active eligibility rules',
          );
          reEvaluated++;
        } catch (error) {
          warnings.push(
            `Eligibility re-evaluation skipped for ${row.studentId}: ${this.errorMessage(error)}`,
          );
        }
      }

      projected++;
    }

    return {
      mode: 'OFFICIAL',
      projected,
      reEvaluated,
      selectionCycleId: cycleId,
      warnings,
    };
  }

  async importProject8(payload: Project8ResultsDto) {
    if (!this.enabled()) return { mode: 'STANDALONE', projected: 0, warnings: [] };

    const cycleId = await this.resolveCycle(payload.selectionCycleId);
    const warnings: string[] = [];
    let projected = 0;

    for (const row of payload.records) {
      const student = await this.prisma.student.findUnique({
        where: { studentId: row.studentId },
      });
      if (!student) {
        warnings.push(`Unknown official student ${row.studentId}`);
        continue;
      }

      const previousAttempts = await this.prisma.assessmentResult.count({
        where: { studentId: student.id, assessmentType: 'INTERVIEW' },
      });

      await this.prisma.assessmentResult.upsert({
        where: {
          studentId_sourceIdentifier: {
            studentId: student.id,
            sourceIdentifier: row.attemptId,
          },
        },
        update: {
          score: row.score,
          maxScore: 100,
          percentage: row.score,
          assessmentDate: new Date(row.interviewedAt),
          metadata: {
            source: 'PROJECT_8',
            outcome: row.outcome,
            notes: row.notes ?? null,
            sourceBatchId: payload.sourceBatchId,
          },
        },
        create: {
          studentId: student.id,
          sourceIdentifier: row.attemptId,
          assessmentType: 'INTERVIEW',
          score: row.score,
          maxScore: 100,
          percentage: row.score,
          attemptNumber: previousAttempts + 1,
          assessmentDate: new Date(row.interviewedAt),
          metadata: {
            source: 'PROJECT_8',
            outcome: row.outcome,
            notes: row.notes ?? null,
            sourceBatchId: payload.sourceBatchId,
          },
        },
      });

      if (cycleId) {
        const classification = await this.prisma.hopePepClassification.findUnique({
          where: {
            studentId_selectionCycleId: {
              studentId: student.id,
              selectionCycleId: cycleId,
            },
          },
        });

        if (row.outcome === 'PASS') {
          await this.updateCycleState(
            student.id,
            cycleId,
            'SELECTION',
            'PROJECT_8',
            'Interview passed; student advanced to selection',
          );
        } else if (row.outcome === 'FAIL' && classification?.program === 'HOPE') {
          await this.prisma.hopePepClassification.update({
            where: { id: classification.id },
            data: {
              program: 'PEP',
              status: 'PEP_FALLBACK_ALLOWED',
              adminDecisionReason: 'HOPE interview failed; routed to PEP fallback',
            },
          });
          await this.updateCycleState(
            student.id,
            cycleId,
            'INTERVIEW',
            'PROJECT_8',
            'HOPE interview failed; student routed to PEP interview fallback',
          );
        } else {
          if (classification && row.outcome === 'FAIL') {
            await this.prisma.hopePepClassification.update({
              where: { id: classification.id },
              data: { status: 'PEP_FALLBACK_DENIED' },
            });
          }
          await this.updateCycleState(
            student.id,
            cycleId,
            'ADMIN_REVIEW',
            'PROJECT_8',
            'Interview outcome requires authorized administrative review',
          );
        }
      }

      projected++;
    }

    return {
      mode: 'OFFICIAL',
      projected,
      selectionCycleId: cycleId,
      warnings,
    };
  }

  async exportProject1Candidates(selectionCycleId?: string) {
    if (!this.enabled()) return null;
    const cycleId = await this.requireCycle(selectionCycleId);

    const classifications = await this.prisma.hopePepClassification.findMany({
      where: {
        selectionCycleId: cycleId,
        program: { in: ['HOPE', 'PEP'] },
      },
      orderBy: { rank: 'asc' },
      include: { student: { include: { batch: { include: { department: true } } } } },
    });

    const candidates = [];
    for (const item of classifications) {
      const existing = await this.prisma.assessmentResult.findFirst({
        where: { studentId: item.studentId, assessmentType: 'COMMUNICATION' },
      });
      if (existing) continue;
      candidates.push(this.candidate(item.student, cycleId, item.program, item.rank));
    }
    return candidates;
  }

  async exportProject8Candidates(selectionCycleId?: string) {
    if (!this.enabled()) return null;
    const cycleId = await this.requireCycle(selectionCycleId);

    const classifications = await this.prisma.hopePepClassification.findMany({
      where: {
        selectionCycleId: cycleId,
        program: { in: ['HOPE', 'PEP'] },
      },
      orderBy: { rank: 'asc' },
      include: { student: { include: { batch: { include: { department: true } } } } },
    });

    const candidates = [];
    for (const item of classifications) {
      const communication = await this.prisma.assessmentResult.findFirst({
        where: {
          studentId: item.studentId,
          assessmentType: 'COMMUNICATION',
          percentage: { gte: 50 },
        },
        orderBy: { assessmentDate: 'desc' },
      });
      if (!communication) continue;

      const passed = await this.prisma.assessmentResult.findFirst({
        where: {
          studentId: item.studentId,
          assessmentType: 'INTERVIEW',
          metadata: { path: ['outcome'], equals: 'PASS' },
        },
      });
      if (passed) continue;

      candidates.push(this.candidate(item.student, cycleId, item.program, item.rank));
    }
    return candidates;
  }

  private async resolveCycle(selectionCycleId?: string) {
    if (selectionCycleId) {
      const cycle = await this.prisma.selectionCycle.findUnique({
        where: { id: selectionCycleId },
      });
      if (!cycle) throw new NotFoundException('Selection cycle not found');
      return cycle.id;
    }

    const active = await this.prisma.selectionCycle.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });

    return active.length === 1 ? active[0].id : null;
  }

  private async requireCycle(selectionCycleId?: string) {
    const cycleId = await this.resolveCycle(selectionCycleId);
    if (!cycleId) {
      throw new BadRequestException(
        'selectionCycleId is required when there is not exactly one active cycle',
      );
    }
    return cycleId;
  }

  private async findDomain(value: string) {
    const trimmed = value.trim();
    const code = trimmed.match(/^(PEPC-\d+)/i)?.[1]?.toUpperCase();
    if (code) {
      const byCode = await this.prisma.domain.findUnique({ where: { code } });
      if (byCode) return byCode;
    }

    return this.prisma.domain.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
  }

  private async upsertAssessment(
    studentId: string,
    sourceIdentifier: string,
    assessmentType: 'CODING' | 'APTITUDE' | 'OTHER',
    score: number,
    maxScore: number,
    assessmentDate: Date,
    metadata: Record<string, unknown>,
  ) {
    const percentage = maxScore > 0 ? (score / maxScore) * 100 : null;

    await this.prisma.assessmentResult.upsert({
      where: {
        studentId_sourceIdentifier: { studentId, sourceIdentifier },
      },
      update: {
        score,
        maxScore,
        percentage,
        assessmentDate,
        metadata: metadata as Prisma.InputJsonValue,
      },
      create: {
        studentId,
        sourceIdentifier,
        assessmentType,
        score,
        maxScore,
        percentage,
        assessmentDate,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async updateCycleState(
    studentId: string,
    selectionCycleId: string,
    currentState:
      | 'IMPORTED'
      | 'ELIGIBILITY'
      | 'HOPE_PEP'
      | 'COMMUNICATION'
      | 'INTERVIEW'
      | 'SELECTION'
      | 'ALLOCATION'
      | 'ADMIN_REVIEW'
      | 'FINALIZED'
      | 'FROZEN',
    actor = 'INTEGRATION_GATEWAY',
    reason = 'External integration workflow update',
  ) {
    const previous = await this.prisma.studentCycleStatus.findUnique({
      where: {
        studentId_selectionCycleId: { studentId, selectionCycleId },
      },
    });

    if (previous?.currentState === currentState) return previous;

    const updated = await this.prisma.studentCycleStatus.upsert({
      where: {
        studentId_selectionCycleId: { studentId, selectionCycleId },
      },
      update: { currentState },
      create: { studentId, selectionCycleId, currentState },
    });

    await this.prisma.workflowAuditLog.create({
      data: {
        studentCycleStatusId: updated.id,
        studentId,
        selectionCycleId,
        fromState: previous?.currentState ?? 'IMPORTED',
        toState: currentState,
        actor,
        role: 'SYSTEM',
        reason,
        metadata: { source: 'OFFICIAL_INTEGRATION' },
      },
    });

    return updated;
  }

  private candidate(
    student: {
      id: string;
      studentId: string;
      registerNumber: string | null;
      name: string;
      email: string | null;
      batch: {
        batchIdentifier: string;
        department: { code: string };
      };
    },
    selectionCycleId: string,
    program: string,
    rank: number,
  ) {
    return {
      studentId: student.studentId,
      internalStudentId: student.id,
      registerNumber: student.registerNumber,
      name: student.name,
      email: student.email,
      department: student.batch.department.code,
      batchIdentifier: student.batch.batchIdentifier,
      selectionCycleId,
      program,
      rank,
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
