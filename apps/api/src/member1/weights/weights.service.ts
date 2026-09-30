import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WeightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createVersion(
    selectionCycleId: string,
    weights: Array<{
      parameterKey: string;
      parameterLabel: string;
      weight: number;
      maxRawScore: number;
      sortOrder: number;
    }>,
    actorId: string,
    description?: string,
  ): Promise<{ id: string; version: number }> {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    if (weights.length === 0) {
      throw new BadRequestException(
        'At least one parameter weight is required',
      );
    }

    const keys = weights.map((w) => w.parameterKey);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Duplicate parameterKey in weights');
    }

    if (weights.some((w) => !Number.isFinite(w.weight) || w.weight < 0)) {
      throw new BadRequestException('Weights must be finite non-negative numbers');
    }
    if (weights.some((w) => !Number.isFinite(w.maxRawScore) || w.maxRawScore <= 0)) {
      throw new BadRequestException('maxRawScore must be a positive finite number');
    }
    if (weights.reduce((sum, w) => sum + w.weight, 0) <= 0) {
      throw new BadRequestException('At least one parameter must have a positive weight');
    }

    const latest = await this.prisma.weightVersion.findFirst({
      where: { selectionCycleId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const created = await this.prisma.weightVersion.create({
      data: {
        selectionCycleId,
        version: nextVersion,
        description: description ?? null,
        createdBy: actorId,
        weights: {
          create: weights.map((w) => ({
            parameterKey: w.parameterKey,
            parameterLabel: w.parameterLabel,
            weight: w.weight,
            maxRawScore: w.maxRawScore,
            sortOrder: w.sortOrder,
          })),
        },
      },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'WEIGHT_VERSION_CREATED',
      actor: actorId,
      entityType: 'WeightVersion',
      entityId: created.id,
      newValue: {
        version: nextVersion,
        parameterCount: weights.length,
        description: description ?? null,
      },
    });

    return { id: created.id, version: nextVersion };
  }

  async activate(
    selectionCycleId: string,
    weightVersionId: string,
    actorId: string,
  ): Promise<void> {
    const wv = await this.prisma.weightVersion.findUnique({
      where: { id: weightVersionId },
    });
    if (!wv) throw new NotFoundException('Weight version not found');
    if (wv.selectionCycleId !== selectionCycleId) {
      throw new BadRequestException(
        'Weight version does not belong to this cycle',
      );
    }

    const config = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!config) {
      throw new NotFoundException(
        'Cycle configuration not found. Create a CycleConfig first.',
      );
    }

    const previousVersionId = config.activeWeightVersionId;

    await this.prisma.cycleConfig.update({
      where: { selectionCycleId },
      data: { activeWeightVersionId: weightVersionId },
    });

    await this.audit.log({
      selectionCycleId,
      action: 'WEIGHT_VERSION_ACTIVATED',
      actor: actorId,
      entityType: 'WeightVersion',
      entityId: weightVersionId,
      previousValue: previousVersionId
        ? { activeWeightVersionId: previousVersionId }
        : undefined,
      newValue: { activeWeightVersionId: weightVersionId },
    });
  }

  async getVersions(
    selectionCycleId: string,
  ): Promise<
    Array<{
      id: string;
      version: number;
      description: string | null;
      createdBy: string;
      createdAt: Date;
      parameterCount: number;
    }>
  > {
    const versions = await this.prisma.weightVersion.findMany({
      where: { selectionCycleId },
      include: { _count: { select: { weights: true } } },
      orderBy: { version: 'desc' },
    });

    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      description: v.description,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      parameterCount: v._count.weights,
    }));
  }

  async getVersion(weightVersionId: string): Promise<{
    id: string;
    selectionCycleId: string;
    version: number;
    description: string | null;
    createdBy: string;
    createdAt: Date;
    weights: Array<{
      parameterKey: string;
      parameterLabel: string;
      weight: number;
      maxRawScore: number;
      sortOrder: number;
    }>;
  }> {
    const wv = await this.prisma.weightVersion.findUnique({
      where: { id: weightVersionId },
      include: { weights: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!wv) throw new NotFoundException('Weight version not found');

    return {
      id: wv.id,
      selectionCycleId: wv.selectionCycleId,
      version: wv.version,
      description: wv.description,
      createdBy: wv.createdBy,
      createdAt: wv.createdAt,
      weights: wv.weights.map((w) => ({
        parameterKey: w.parameterKey,
        parameterLabel: w.parameterLabel,
        weight: w.weight,
        maxRawScore: w.maxRawScore,
        sortOrder: w.sortOrder,
      })),
    };
  }

  async getActiveVersion(selectionCycleId: string): Promise<{
    id: string;
    version: number;
    description: string | null;
    weights: Array<{
      parameterKey: string;
      parameterLabel: string;
      weight: number;
      maxRawScore: number;
      sortOrder: number;
    }>;
  } | null> {
    const config = await this.prisma.cycleConfig.findUnique({
      where: { selectionCycleId },
    });
    if (!config?.activeWeightVersionId) return null;

    const wv = await this.prisma.weightVersion.findUnique({
      where: { id: config.activeWeightVersionId },
      include: { weights: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!wv) return null;

    return {
      id: wv.id,
      version: wv.version,
      description: wv.description,
      weights: wv.weights.map((w) => ({
        parameterKey: w.parameterKey,
        parameterLabel: w.parameterLabel,
        weight: w.weight,
        maxRawScore: w.maxRawScore,
        sortOrder: w.sortOrder,
      })),
    };
  }
}
