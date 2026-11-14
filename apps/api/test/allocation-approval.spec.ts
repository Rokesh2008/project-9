import { BadRequestException } from '@nestjs/common';
import { AllocationService } from '../src/allocation/allocation.service';

describe('AllocationService.approve', () => {
  const allocation = {
    id: 'allocation-1',
    studentId: 'student-1',
    selectionCycleId: 'cycle-1',
    domainId: 'domain-1',
    trainingBatchId: 'batch-1',
    status: 'PENDING_APPROVAL',
    isFrozen: false,
  };

  let tx: any;
  let prisma: any;
  let service: AllocationService;

  beforeEach(() => {
    tx = {
      allocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...allocation,
          status: 'APPROVED',
          isFinalized: true,
        }),
      },
      adminDecision: { create: jest.fn().mockResolvedValue({}) },
      studentCycleStatus: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle-status-1' }) },
      workflowAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      allocation: { findUnique: jest.fn().mockResolvedValue(allocation) },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
    };
    service = new AllocationService(prisma as any);
  });

  it('finalizes the allocation and writes decision and audit records in one transaction', async () => {
    const result = await service.approve('allocation-1', 'admin-1', 'ADMIN', 'Approved');

    expect(result).toMatchObject({ id: 'allocation-1', status: 'APPROVED', isFinalized: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.allocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'allocation-1',
        status: { in: ['PENDING_APPROVAL', 'MANUAL_REVIEW'] },
        isFrozen: false,
      },
      data: expect.objectContaining({
        status: 'APPROVED',
        isFinalized: true,
        finalizedBy: 'admin-1',
      }),
    }));
    expect(tx.adminDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        selectionCycleId: 'cycle-1',
        decisionType: 'APPROVE_ALLOCATION',
        actor: 'admin-1',
        role: 'ADMIN',
      }),
    });
    expect(tx.workflowAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        selectionCycleId: 'cycle-1',
        fromState: 'ADMIN_REVIEW',
        toState: 'FINALIZED',
        reason: 'Approved',
      }),
    });
  });

  it('does not write decisions or audit records when another request wins the approval race', async () => {
    tx.allocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.approve('allocation-1', 'admin-1', 'ADMIN', 'Approved'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.adminDecision.create).not.toHaveBeenCalled();
    expect(tx.workflowAuditLog.create).not.toHaveBeenCalled();
  });

  it('keeps the existing status validation for allocations that are not awaiting approval', async () => {
    prisma.allocation.findUnique.mockResolvedValue({ ...allocation, status: 'REJECTED' });

    await expect(
      service.approve('allocation-1', 'admin-1', 'ADMIN', 'Approved'),
    ).rejects.toThrow('Cannot approve allocation with status REJECTED');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
