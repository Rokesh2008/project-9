import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  source: 'workflow' | 'scoring';
  action: string;
  actor: string;
  role?: string;
  studentId?: string;
  studentName?: string;
  selectionCycleId: string;
  detail?: string;
  metadata?: unknown;
}

@Injectable()
export class UnifiedAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(params: {
    selectionCycleId: string;
    studentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditEntry[]; total: number }> {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    const workflowWhere: any = { selectionCycleId: params.selectionCycleId };
    const scoreWhere: any = { selectionCycleId: params.selectionCycleId };
    if (params.studentId) {
      workflowWhere.studentId = params.studentId;
      scoreWhere.entityId = params.studentId;
    }

    const [workflowLogs, scoreLogs, wCount, sCount] = await Promise.all([
      this.prisma.workflowAuditLog.findMany({
        where: workflowWhere,
        include: { student: { select: { studentId: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.scoreAuditLog.findMany({
        where: scoreWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.workflowAuditLog.count({ where: workflowWhere }),
      this.prisma.scoreAuditLog.count({ where: scoreWhere }),
    ]);

    const entries: AuditEntry[] = [];

    for (const w of workflowLogs) {
      entries.push({
        id: w.id,
        timestamp: w.createdAt,
        source: 'workflow',
        action: `${w.fromState} → ${w.toState}`,
        actor: w.actor,
        role: w.role,
        studentId: w.student?.studentId,
        studentName: w.student?.name,
        selectionCycleId: w.selectionCycleId,
        detail: w.reason ?? undefined,
      });
    }

    for (const s of scoreLogs) {
      entries.push({
        id: s.id,
        timestamp: s.createdAt,
        source: 'scoring',
        action: s.action,
        actor: s.actor,
        role: s.role ?? undefined,
        studentId: undefined,
        studentName: undefined,
        selectionCycleId: s.selectionCycleId,
        detail: s.entityType ? `${s.entityType}:${s.entityId}` : undefined,
        metadata: {
          previousValue: s.previousValue,
          newValue: s.newValue,
        },
      });
    }

    entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const merged = entries.slice(0, limit);

    return { entries: merged, total: wCount + sCount };
  }
}
