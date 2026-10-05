import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class DomainsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllDomains() {
    return this.prisma.domain.findMany({
      where: { isActive: true },
      include: {
        program: { select: { id: true, code: true, name: true } },
        trainingBatches: { where: { isActive: true } },
        _count: { select: { allocations: true, preferences: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async findOneDomain(id: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id },
      include: {
        program: true,
        trainingBatches: true,
        requirements: true,
        _count: { select: { allocations: true, preferences: true } },
      },
    });
    if (!domain) throw new NotFoundException('Domain not found');
    return domain;
  }

  async createDomain(params: {
    programId: string;
    code: string;
    name: string;
    description?: string;
  }) {
    return this.prisma.domain.create({
      data: {
        programId: params.programId,
        code: params.code,
        name: params.name,
        description: params.description,
      },
      include: { program: true },
    });
  }

  async createProgram(params: { code: string; name: string; description?: string }) {
    return this.prisma.program.create({ data: params });
  }

  async findAllPrograms() {
    return this.prisma.program.findMany({
      where: { isActive: true },
      include: { _count: { select: { domains: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async createTrainingBatch(params: {
    domainId: string;
    batchCode: string;
    batchName: string;
    maxCapacity: number;
    startDate?: string;
    endDate?: string;
  }) {
    return this.prisma.trainingBatch.create({
      data: {
        domainId: params.domainId,
        batchCode: params.batchCode,
        batchName: params.batchName,
        maxCapacity: params.maxCapacity,
        startDate: params.startDate ? new Date(params.startDate) : null,
        endDate: params.endDate ? new Date(params.endDate) : null,
      },
    });
  }

  async getCapacitySummary() {
    const domains = await this.prisma.domain.findMany({
      where: { isActive: true },
      include: {
        trainingBatches: { where: { isActive: true } },
      },
    });

    return domains.map((d) => {
      const capacity = d.trainingBatches.reduce((sum, b) => sum + b.maxCapacity, 0);
      const allocated = d.trainingBatches.reduce((sum, b) => sum + b.currentAllocated, 0);
      return {
        domainId: d.id,
        code: d.code,
        name: d.name,
        capacity,
        allocated,
        available: capacity - allocated,
      };
    });
  }
}
