import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowState } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const VALID_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  IMPORTED: [WorkflowState.ELIGIBILITY],
  ELIGIBILITY: [WorkflowState.HOPE_PEP],
  HOPE_PEP: [WorkflowState.COMMUNICATION],
  COMMUNICATION: [WorkflowState.INTERVIEW],
  INTERVIEW: [WorkflowState.SELECTION],
  SELECTION: [WorkflowState.ALLOCATION],
  ALLOCATION: [WorkflowState.ADMIN_REVIEW],
  ADMIN_REVIEW: [WorkflowState.FINALIZED, WorkflowState.ALLOCATION],
  FINALIZED: [WorkflowState.FROZEN],
  FROZEN: [],
};

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  canTransition(from: WorkflowState, to: WorkflowState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  async ensureStatus(studentId: string, selectionCycleId: string) {
    return this.prisma.studentCycleStatus.upsert({
      where: { studentId_selectionCycleId: { studentId, selectionCycleId } },
      create: { studentId, selectionCycleId, currentState: WorkflowState.IMPORTED },
      update: {},
    });
  }

  async advanceState(params: {
    studentId: string;
    selectionCycleId: string;
    targetState: WorkflowState;
    actor: string;
    role: string;
    reason?: string;
  }) {
    const scs = await this.prisma.studentCycleStatus.findUnique({
      where: {
        studentId_selectionCycleId: {
          studentId: params.studentId,
          selectionCycleId: params.selectionCycleId,
        },
      },
    });

    if (!scs) {
      throw new NotFoundException(
        `No cycle status for student ${params.studentId} in cycle ${params.selectionCycleId}`,
      );
    }

    if (scs.isFrozen) {
      throw new BadRequestException('Student is frozen — state cannot be changed');
    }

    if (!this.canTransition(scs.currentState, params.targetState)) {
      throw new BadRequestException(
        `Invalid transition: ${scs.currentState} → ${params.targetState}`,
      );
    }

    const fromState = scs.currentState;

    const updated = await this.prisma.studentCycleStatus.update({
      where: { id: scs.id },
      data: {
        currentState: params.targetState,
        ...(params.targetState === WorkflowState.FROZEN
          ? { isFrozen: true, frozenAt: new Date(), frozenBy: params.actor }
          : {}),
      },
    });

    await this.prisma.workflowAuditLog.create({
      data: {
        studentCycleStatusId: scs.id,
        studentId: params.studentId,
        selectionCycleId: params.selectionCycleId,
        fromState,
        toState: params.targetState,
        actor: params.actor,
        role: params.role,
        reason: params.reason ?? null,
      },
    });

    return updated;
  }

  async advanceBatch(params: {
    selectionCycleId: string;
    fromState: WorkflowState;
    targetState: WorkflowState;
    actor: string;
    role: string;
    reason?: string;
    studentIds?: string[];
  }) {
    if (!this.canTransition(params.fromState, params.targetState)) {
      throw new BadRequestException(
        `Invalid transition: ${params.fromState} → ${params.targetState}`,
      );
    }

    const where: any = {
      selectionCycleId: params.selectionCycleId,
      currentState: params.fromState,
      isFrozen: false,
    };
    if (params.studentIds?.length) {
      where.studentId = { in: params.studentIds };
    }

    const statuses = await this.prisma.studentCycleStatus.findMany({ where });

    for (const scs of statuses) {
      await this.prisma.studentCycleStatus.update({
        where: { id: scs.id },
        data: {
          currentState: params.targetState,
          ...(params.targetState === WorkflowState.FROZEN
            ? { isFrozen: true, frozenAt: new Date(), frozenBy: params.actor }
            : {}),
        },
      });

      await this.prisma.workflowAuditLog.create({
        data: {
          studentCycleStatusId: scs.id,
          studentId: scs.studentId,
          selectionCycleId: params.selectionCycleId,
          fromState: params.fromState,
          toState: params.targetState,
          actor: params.actor,
          role: params.role,
          reason: params.reason ?? null,
        },
      });
    }

    return { advanced: statuses.length, from: params.fromState, to: params.targetState };
  }

  async getStatus(studentId: string, selectionCycleId: string) {
    const scs = await this.prisma.studentCycleStatus.findUnique({
      where: { studentId_selectionCycleId: { studentId, selectionCycleId } },
    });
    if (!scs) {
      throw new NotFoundException(
        `No cycle status for student ${studentId} in cycle ${selectionCycleId}`,
      );
    }
    return scs;
  }

  async getAuditTrail(selectionCycleId: string, studentId?: string) {
    const where: any = { selectionCycleId };
    if (studentId) where.studentId = studentId;

    return this.prisma.workflowAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { student: { select: { studentId: true, name: true } } },
    });
  }

  async getCycleSummary(selectionCycleId: string) {
    const statuses = await this.prisma.studentCycleStatus.groupBy({
      by: ['currentState'],
      where: { selectionCycleId },
      _count: { id: true },
    });

    const total = statuses.reduce((sum, s) => sum + s._count.id, 0);
    const byState: Record<string, number> = {};
    for (const s of statuses) {
      byState[s.currentState] = s._count.id;
    }

    return { selectionCycleId, total, byState };
  }
}
