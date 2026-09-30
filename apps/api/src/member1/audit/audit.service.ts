import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    selectionCycleId: string;
    action: string;
    actor: string;
    role?: string;
    entityType?: string;
    entityId?: string;
    previousValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.scoreAuditLog.create({
      data: {
        selectionCycleId: params.selectionCycleId,
        action: params.action,
        actor: params.actor,
        role: params.role ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        previousValue: params.previousValue
          ? (params.previousValue as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        newValue: params.newValue
          ? (params.newValue as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        reason: params.reason ?? null,
        metadata: params.metadata
          ? (params.metadata as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  }
}
