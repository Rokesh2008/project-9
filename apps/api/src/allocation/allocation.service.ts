import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuthPrincipal } from '../auth/auth.service';

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
        include: {
          domain: {
            include: {
              trainingBatches: {
                where: { isActive: true },
                orderBy: { batchCode: 'asc' },
              },
            },
          },
        },
      });

      let allocated = false;

      for (const pref of preferences) {
        for (const batch of pref.domain.trainingBatches) {
          const claimed = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.$executeRaw`
              UPDATE "TrainingBatch"
              SET "currentAllocated" = "currentAllocated" + 1,
                  "updatedAt" = NOW()
              WHERE "id" = ${batch.id}
                AND "currentAllocated" < "maxCapacity"
            `;

            if (updated !== 1) return false;

            await tx.allocation.create({
              data: {
                studentId: scs.studentId,
                selectionCycleId,
                domainId: pref.domainId,
                trainingBatchId: batch.id,
                status: 'PENDING_APPROVAL',
                preferenceRankUsed: pref.preferenceRank,
              },
            });

            const cycleStatus = await tx.studentCycleStatus.findUnique({
              where: {
                studentId_selectionCycleId: {
                  studentId: scs.studentId,
                  selectionCycleId,
                },
              },
            });

            await tx.workflowAuditLog.create({
              data: {
                studentCycleStatusId: cycleStatus?.id ?? null,
                studentId: scs.studentId,
                selectionCycleId,
                fromState: 'ALLOCATION',
                toState: 'ADMIN_REVIEW',
                actor: actorId,
                role: 'SYSTEM',
                reason: `Allocated to ${pref.domain.code} (preference #${pref.preferenceRank})`,
              },
            });

            return true;
          });

          if (!claimed) continue;

          results.push({
            studentId: scs.studentId,
            status: 'PENDING_APPROVAL',
            domainCode: pref.domain.code,
            preferenceRank: pref.preferenceRank,
          });
          allocated = true;
          break;
        }

        if (allocated) break;
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

  async applyApprovedRecommendation(
    externalStudentId: string,
    selectionCycleId: string,
    domainCode: string,
    actorId: string,
    reason: string,
    actorRole = 'ADMIN',
  ) {
    const student = await this.prisma.student.findUnique({
      where: { studentId: externalStudentId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const domain = await this.prisma.domain.findUnique({
      where: { code: domainCode },
      include: {
        trainingBatches: {
          where: { isActive: true },
          orderBy: { batchCode: 'asc' },
        },
      },
    });
    if (!domain) throw new NotFoundException('Recommended domain not found');

    const existing = await this.prisma.allocation.findUnique({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId,
        },
      },
    });
    if (existing) {
      if (existing.domainId === domain.id && ['APPROVED', 'FROZEN'].includes(existing.status)) {
        return existing;
      }
      throw new BadRequestException('Student already has an allocation for this cycle');
    }

    for (const batch of domain.trainingBatches) {
      const allocation = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$executeRaw`
          UPDATE "TrainingBatch"
          SET "currentAllocated" = "currentAllocated" + 1,
              "updatedAt" = NOW()
          WHERE "id" = ${batch.id}
            AND "currentAllocated" < "maxCapacity"
        `;
        if (claimed !== 1) return null;

        const created = await tx.allocation.create({
          data: {
            studentId: student.id,
            selectionCycleId,
            domainId: domain.id,
            trainingBatchId: batch.id,
            status: 'APPROVED',
            isFinalized: true,
            finalizedAt: new Date(),
            finalizedBy: actorId,
            metadata: { source: 'SELECTION_INTELLIGENCE_AGENT', approvedBy: actorId },
          },
        });

        const cycleStatus = await tx.studentCycleStatus.findUnique({
          where: {
            studentId_selectionCycleId: {
              studentId: student.id,
              selectionCycleId,
            },
          },
        });

        await tx.studentCycleStatus.upsert({
          where: {
            studentId_selectionCycleId: {
              studentId: student.id,
              selectionCycleId,
            },
          },
          update: { currentState: 'FINALIZED' },
          create: {
            studentId: student.id,
            selectionCycleId,
            currentState: 'FINALIZED',
          },
        });

        await tx.adminDecision.create({
          data: {
            studentId: student.id,
            selectionCycleId,
            decisionType: 'OVERRIDE_ALLOCATION',
            reason,
            actor: actorId,
            role: actorRole,
            targetDomainId: domain.id,
            targetBatchId: batch.id,
            metadata: { source: 'SELECTION_INTELLIGENCE_AGENT' },
          },
        });

        await tx.workflowAuditLog.create({
          data: {
            studentCycleStatusId: cycleStatus?.id ?? null,
            studentId: student.id,
            selectionCycleId,
            fromState: cycleStatus?.currentState ?? 'ALLOCATION',
            toState: 'FINALIZED',
            actor: actorId,
            role: actorRole,
            reason,
            metadata: {
              source: 'SELECTION_INTELLIGENCE_AGENT',
              domainCode,
            },
          },
        });

        return created;
      });

      if (allocation) return allocation;
    }

    throw new BadRequestException('Recommended domain has no available capacity');
  }

  async findAll(selectionCycleId?: string, principal?: AuthPrincipal) {
    const facultyDomainId = this.facultyDomain(principal);
    return this.prisma.allocation.findMany({
      where: {
        ...(selectionCycleId ? { selectionCycleId } : {}),
        ...(facultyDomainId ? { domainId: facultyDomainId } : {}),
      },
      include: { student: true, domain: true, trainingBatch: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStudent(studentId: string, principal?: AuthPrincipal) {
    const facultyDomainId = this.facultyDomain(principal);
    const allocation = await this.prisma.allocation.findFirst({
      where: { studentId, ...(facultyDomainId ? { domainId: facultyDomainId } : {}) },
      include: { student: true, domain: true, trainingBatch: true, selectionCycle: true },
    });
    if (!allocation) throw new NotFoundException('No allocation found for this student');
    return allocation;
  }

  async approve(allocationId: string, actorId: string, role: string, reason: string, facultyDomainId?: string | null) {
    this.assertAdminRole(role);
    const allocation = await this.getAllocationOrFail(allocationId);
    this.assertFacultyAllocation(role, facultyDomainId, allocation.domainId);

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

  async reject(allocationId: string, actorId: string, role: string, reason: string, facultyDomainId?: string | null) {
    this.assertAdminRole(role);
    const allocation = await this.getAllocationOrFail(allocationId);
    this.assertFacultyAllocation(role, facultyDomainId, allocation.domainId);

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
      data: { status: 'REJECTED', failureReason: reason },
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

  private facultyDomain(principal?: AuthPrincipal) {
    if (principal?.role !== 'PEP_STAFF') return null;
    if (!principal.facultyDomainId) throw new ForbiddenException('No faculty domain assigned');
    return principal.facultyDomainId;
  }

  private assertFacultyAllocation(role: string, assignedDomainId: string | null | undefined, allocationDomainId: string | null) {
    if (role === 'PEP_STAFF' && (!assignedDomainId || assignedDomainId !== allocationDomainId)) {
      throw new ForbiddenException('You can decide allocations only for your assigned domain');
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
