import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createConfig(
    selectionCycleId: string,
    hopeCount: number,
    pepCount: number,
    actorId: string,
  ): Promise<{ id: string }> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const existing = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (existing) {
      throw new BadRequestException(
        'Cycle configuration already exists for this cycle',
      );
    }

    const config = await this.prisma.cycleConfig.create({
      data: {
        selectionCycleId,
        hopeCount,
        pepCount,
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'CYCLE_CONFIG_CREATED',
      actor: actorId,
      entityType: 'CycleConfig',
      entityId: config.id,
      newValue: { hopeCount, pepCount },
    });

    return { id: config.id };
  }

  async updateConfig(
    selectionCycleId: string,
    updates: {
      hopeCount?: number;
      pepCount?: number;
      activeWeightVersionId?: string;
      eligibilityRuleVersionId?: string;
    },
    actorId: string,
  ): Promise<void> {
    const config = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!config) {
      throw new NotFoundException('Cycle configuration not found');
    }

    const previousValue: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};

    if (updates.hopeCount !== undefined) {
      previousValue.hopeCount = config.hopeCount;
      data.hopeCount = updates.hopeCount;
    }
    if (updates.pepCount !== undefined) {
      previousValue.pepCount = config.pepCount;
      data.pepCount = updates.pepCount;
    }
    if (updates.activeWeightVersionId !== undefined) {
      previousValue.activeWeightVersionId = config.activeWeightVersionId;
      data.activeWeightVersionId = updates.activeWeightVersionId;
    }
    if (updates.eligibilityRuleVersionId !== undefined) {
      previousValue.eligibilityRuleVersionId =
        config.eligibilityRuleVersionId;
      data.eligibilityRuleVersionId = updates.eligibilityRuleVersionId;
    }

    await this.prisma.cycleConfig.update({
      where: { selectionCycleId },
      data,
    });

    await this.audit.log({
      selectionCycleId,
      action: 'CYCLE_CONFIG_UPDATED',
      actor: actorId,
      entityType: 'CycleConfig',
      entityId: config.id,
      previousValue,
      newValue: data as Record<string, unknown>,
    });
  }

  async getConfig(selectionCycleId: string): Promise<{
    id: string;
    selectionCycleId: string;
    hopeCount: number;
    pepCount: number;
    activeWeightVersionId: string | null;
    eligibilityRuleVersionId: string | null;
  } | null> {
    const config = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!config) return null;

    return {
      id: config.id,
      selectionCycleId: config.selectionCycleId,
      hopeCount: config.hopeCount,
      pepCount: config.pepCount,
      activeWeightVersionId: config.activeWeightVersionId,
      eligibilityRuleVersionId: config.eligibilityRuleVersionId,
    };
  }
}
