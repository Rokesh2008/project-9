import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CycleStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class SelectionCycleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    code: string;
    name: string;
    academicPeriod: string;
    startDate: string;
    endDate: string;
  }) {
    return this.prisma.selectionCycle.create({
      data: {
        code: params.code,
        name: params.name,
        academicPeriod: params.academicPeriod,
        startDate: new Date(params.startDate),
        endDate: new Date(params.endDate),
        status: CycleStatus.DRAFT,
      },
    });
  }

  async findAll() {
    return this.prisma.selectionCycle.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            studentCycleStatuses: true,
            allocations: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id },
      include: {
        cycleConfig: true,
        _count: {
          select: {
            studentCycleStatuses: true,
            allocations: true,
            eligibilityResults: true,
            studentRankings: true,
          },
        },
      },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');
    return cycle;
  }

  async activate(id: string) {
    const cycle = await this.findOne(id);
    if (cycle.status !== CycleStatus.DRAFT) {
      throw new BadRequestException(`Cycle must be in DRAFT status to activate (current: ${cycle.status})`);
    }
    return this.prisma.selectionCycle.update({
      where: { id },
      data: { status: CycleStatus.ACTIVE },
    });
  }

  async complete(id: string) {
    const cycle = await this.findOne(id);
    if (cycle.status !== CycleStatus.ACTIVE && cycle.status !== CycleStatus.FROZEN) {
      throw new BadRequestException(`Cycle must be ACTIVE or FROZEN to complete (current: ${cycle.status})`);
    }
    return this.prisma.selectionCycle.update({
      where: { id },
      data: { status: CycleStatus.COMPLETED },
    });
  }

  async archive(id: string) {
    const cycle = await this.findOne(id);
    if (cycle.status !== CycleStatus.COMPLETED) {
      throw new BadRequestException(`Cycle must be COMPLETED to archive (current: ${cycle.status})`);
    }
    return this.prisma.selectionCycle.update({
      where: { id },
      data: { status: CycleStatus.ARCHIVED },
    });
  }
}
