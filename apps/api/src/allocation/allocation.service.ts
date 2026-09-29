import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AllocationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async generate(selectionCycleId: string, actorId: string) {
    const cycle = await this.prisma.selectionCycle.findUnique({
      where: { id: selectionCycleId },
    });
    if (!cycle) throw new NotFoundException('Selection cycle not found');

    const students = await this.prisma.studentCycleStatus.findMany({
      where: {
        selectionCycleId,
        currentState: 'SELECTION',
      },
      include: { student: true },
    });

    const results: Array<{ studentId: string; status: string; domainCode?: string; preferenceRank?: number; reason?: string }> = [];

    for (const scs of students) {
      const existing = await this.prisma.allocation.findUnique({
        where: { studentId_selectionCycleId: { studentId: scs.studentId, selectionCycleId } },
      });
      if (existing) {
        results.push({ studentId: scs.studentId, status: 'SKIPPED', reason: 'Allocation already exists' });
        continue;
      }

      const preferences = await this.prisma.studentPreference.findMany({
        where: { studentId: scs.studentId, selectionCycleId },
        orderBy: { preferenceRank: 'asc' },
        include: { domain: { include: { trainingBatches: { where: { isActive: true } } } } },
      });

      let allocated = false;

      for (const pref of preferences) {
        const totalCapacity = pref.domain.trainingBatches.reduce((sum, b) => sum + b.maxCapacity, 0);
        const currentCount = await this.prisma.allocation.count({
          where: { domainId: pref.domainId, selectionCycleId, status: { not: 'REJECTED' } },
        });

        if (currentCount < totalCapacity) {
          const batch = pref.domain.trainingBatches.find(
            (b) => b.currentAllocated < b.maxCapacity,
          );

          await this.prisma.allocation.create({
            data: {
              studentId: scs.studentId,
              selectionCycleId,
              domainId: pref.domainId,
              trainingBatchId: batch?.id ?? null,
              status: 'PENDING_APPROVAL',
              preferenceRankUsed: pref.preferenceRank,
            },
          });

          if (batch) {
            await this.prisma.trainingBatch.update({
              where: { id: batch.id },
              data: { currentAllocated: { increment: 1 } },
            });
          }

          await this.writeAudit(scs.studentId, selectionCycleId, 'ALLOCATION', 'ADMIN_REVIEW', actorId, 'SYSTEM', `Allocated to ${pref.domain.code} (preference #${pref.preferenceRank})`);

          results.push({ studentId: scs.studentId, status: 'PENDING_APPROVAL', domainCode: pref.domain.code, preferenceRank: pref.preferenceRank });
          allocated = true;
          break;
        }
      }

      if (!allocated) {
        await this.prisma.allocation.create({
          data: {
            studentId: scs.studentId,
            selectionCycleId,
            status: 'MANUAL_REVIEW',
            failureReason: 'All preferred domains at capacity',
          },
        });

        await this.writeAudit(scs.studentId, selectionCycleId, 'ALLOCATION', 'ADMIN_REVIEW', actorId, 'SYSTEM', 'No preferred domain had capacity');

        results.push({ studentId: scs.studentId, status: 'MANUAL_REVIEW', reason: 'All preferred domains at capacity' });
      }
    }

    return {
      selectionCycleId,
      totalProcessed: students.length,
      allocated: results.filter((r) => r.status === 'PENDING_APPROVAL').length,
      manualReview: results.filter((r) => r.status === 'MANUAL_REVIEW').length,
      skipped: results.filter((r) => r.status === 'SKIPPED').length,
      results,
    };
  }

  async findAll(selectionCycleId?: string) {
    return this.prisma.allocation.findMany({
      where: selectionCycleId ? { selectionCycleId } : undefined,
      include: { student: true, domain: true, trainingBatch: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStudent(studentId: string) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { studentId },
      include: { student: true, domain: true, trainingBatch: true, selectionCycle: true },
    });
    if (!allocation) throw new NotFoundException('No allocation found for this student');
    return allocation;
  }

  async approve(allocationId: string, actorId: string, role: string, reason: string) {
    this.assertAdminRole(role);
    const allocation = await this.getAllocationOrFail(allocationId);

    if (allocation.status !== 'PENDING_APPROVAL' && allocation.status !== 'MANUAL_REVIEW') {
      throw new BadRequestException(`Cannot approve allocation with status ${allocation.status}`);
    }
    if (allocation.isFrozen) throw new BadRequestException('Allocation is frozen');

    const updated = await this.prisma.allocation.update({
      where: { id: allocationId },
      data: { status: 'APPROVED', isFinalized: true, finalizedAt: new Date(), finalizedBy: actorId },
      include: { student: true, domain: true },
    });

    await this.prisma.adminDecision.create({
      data: {
        studentId: allocation.studentId,
        selectionCycleId: allocation.selectionCycleId,
        decisionType: 'APPROVE_ALLOCATION',
        reason,
        actor: actorId,
        role,
        targetDomainId: allocation.domainId,
        targetBatchId: allocation.trainingBatchId,
      },
    });

    await this.writeAudit(allocation.studentId, allocation.selectionCycleId, 'ADMIN_REVIEW', 'FINALIZED', actorId, role, reason);

    return updated;
  }

  async reject(allocationId: string, actorId: string, role: string, reason: string) {
    this.assertAdminRole(role);
    const allocation = await this.getAllocationOrFail(allocationId);

    if (allocation.status === 'FROZEN') throw new BadRequestException('Cannot reject a frozen allocation');
    if (allocation.status === 'REJECTED') throw new BadRequestException('Allocation already rejected');
    if (allocation.isFrozen) throw new BadRequestException('Allocation is frozen');

    if (allocation.trainingBatchId) {
      await this.prisma.trainingBatch.update({
        where: { id: allocation.trainingBatchId },
        data: { currentAllocated: { decrement: 1 } },
      });
    }

    const updated = await this.prisma.allocation.update({
      where: { id: allocationId },
      data: { status: 'REJECTED' },
      include: { student: true, domain: true },
    });

    await this.prisma.adminDecision.create({
      data: {
        studentId: allocation.studentId,
        selectionCycleId: allocation.selectionCycleId,
        decisionType: 'REJECT_ALLOCATION',
        reason,
        actor: actorId,
        role,
        targetDomainId: allocation.domainId,
      },
    });

    await this.writeAudit(allocation.studentId, allocation.selectionCycleId, 'ADMIN_REVIEW', 'ADMIN_REVIEW', actorId, role, `Rejected: ${reason}`);

    return updated;
  }

  async freeze(allocationId: string, actorId: string, role: string) {
    this.assertAdminRole(role);
    const allocation = await this.getAllocationOrFail(allocationId);

    if (allocation.status !== 'APPROVED') {
      throw new BadRequestException('Only approved allocations can be frozen');
    }
    if (allocation.isFrozen) throw new BadRequestException('Allocation is already frozen');

    const updated = await this.prisma.allocation.update({
      where: { id: allocationId },
      data: { status: 'FROZEN', isFrozen: true, frozenAt: new Date(), frozenBy: actorId },
      include: { student: true, domain: true },
    });

    await this.writeAudit(allocation.studentId, allocation.selectionCycleId, 'FINALIZED', 'FROZEN', actorId, role, 'Allocation frozen');

    return updated;
  }

  private async getAllocationOrFail(id: string) {
    const allocation = await this.prisma.allocation.findUnique({ where: { id } });
    if (!allocation) throw new NotFoundException('Allocation not found');
    return allocation;
  }

  private assertAdminRole(role: string) {
    if (!['ADMIN', 'COORDINATOR', 'PEP_STAFF'].includes(role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }
  }

  private async writeAudit(
    studentId: string,
    selectionCycleId: string,
    fromState: string,
    toState: string,
    actor: string,
    role: string,
    reason: string,
  ) {
    const scs = await this.prisma.studentCycleStatus.findUnique({
      where: { studentId_selectionCycleId: { studentId, selectionCycleId } },
    });

    await this.prisma.workflowAuditLog.create({
      data: {
        studentCycleStatusId: scs?.id ?? null,
        studentId,
        selectionCycleId,
        fromState: fromState as any,
        toState: toState as any,
        actor,
        role,
        reason,
      },
    });
  }
}
