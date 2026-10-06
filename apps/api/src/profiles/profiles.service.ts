import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.service';
import { PrismaService } from '../common/prisma.service';

type Failure = { field?: string; actual?: unknown; expected?: unknown; message?: string };

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForStaff(principal: AuthPrincipal, search = '', page = 1) {
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
        ],
      } : {}),
    };
    const [total, students] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        select: {
          studentId: true, registerNumber: true, name: true,
          batch: { select: { department: { select: { code: true } } } },
        },
        orderBy: { studentId: 'asc' }, skip: (safePage - 1) * pageSize, take: pageSize,
      }),
    ]);
    return {
      total, page: safePage, pageSize,
      students: students.map((student) => ({
        studentId: student.studentId, registerNumber: student.registerNumber,
        name: student.name, department: student.batch.department.code,
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

    const status = await this.prisma.studentCycleStatus.findFirst({
      where: { studentId: student.id },
      include: { selectionCycle: true },
      orderBy: { createdAt: 'desc' },
    });
    const identity = {
      studentId: student.studentId, name: student.name,
      registerNumber: student.registerNumber, email: student.email,
      department: student.batch.department.name, batch: student.batch.batchIdentifier,
    };
    const roster = student.rosterAllocation;
    const rosterAllocation = roster ? {
      trainingGroup: roster.trainingGroup, trainingLevel: roster.trainingLevel,
      sourceFile: roster.sourceFile, sourceSheet: roster.sourceSheet, importedAt: roster.importedAt,
    } : null;
    if (!status) {
      const assessment = await this.prisma.assessmentResult.findFirst({ where: { studentId: student.id }, select: { id: true } });
      return {
        student: identity, cycle: null, outcome: 'NOT_IN_CYCLE', rosterAllocation,
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
        nextSteps = ['Your preferred domains need manual capacity review.', 'Wait for an authorized allocation decision.'];
      } else if (outcome === 'FINALIZED') {
        nextSteps = [`Review your assigned domain${allocation?.domain ? `: ${allocation.domain.name}` : ''}.`, 'Follow the training-batch instructions from your coordinator.'];
      } else {
        nextSteps = ['Wait for the faculty or administrator to review the proposed domain allocation.', 'Check this page for a finalized decision.'];
      }
    }

    return {
      student: identity,
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
      if (failure.field === 'attendancePercent') return 'Improve attendance to the configured minimum before the next evaluation.';
      if (failure.field === 'cgpa') return 'Improve your CGPA to the configured minimum before the next cycle.';
      if (failure.field?.toLowerCase().includes('score')) return `Review and improve your ${failure.field} before the next evaluation.`;
      return `Review the ${failure.field ?? 'eligibility'} requirement with the selection coordinator.`;
    });
    return [...new Set([...steps, 'If the underlying data is incorrect, request a correction from the selection coordinator.'])];
  }
}
