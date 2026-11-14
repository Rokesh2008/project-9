import { BadRequestException } from '@nestjs/common';
import { AllocationService } from '../src/allocation/allocation.service';

describe('AllocationService.reject', () => {
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
        findUnique: jest.fn().mockResolvedValue(allocation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...allocation,
          status: 'REJECTED',
          failureReason: 'Not suitable',
        }),
      },
      trainingBatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminDecision: {
        create: jest.fn().mockResolvedValue({}),
      },
      studentCycleStatus: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cycle-status-1' }),
      },
      workflowAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
    };
    service = new AllocationService(prisma as any);
  });

  it('releases capacity and writes the decision and audit record in one transaction', async () => {
    const result = await service.reject('allocation-1', 'admin-1', 'ADMIN', 'Not suitable');

    expect(result).toMatchObject({ id: 'allocation-1', status: 'REJECTED' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.allocation.updateMany).toHaveBeenCalledWith({
      where: { id: 'allocation-1', status: 'PENDING_APPROVAL', isFrozen: false },
      data: { status: 'REJECTED', failureReason: 'Not suitable' },
    });
    expect(tx.trainingBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'batch-1', currentAllocated: { gt: 0 } },
      data: { currentAllocated: { decrement: 1 } },
    });
    expect(tx.adminDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        selectionCycleId: 'cycle-1',
        decisionType: 'REJECT_ALLOCATION',
        actor: 'admin-1',
        role: 'ADMIN',
      }),
    });
    expect(tx.workflowAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        selectionCycleId: 'cycle-1',
        fromState: 'ADMIN_REVIEW',
        toState: 'ADMIN_REVIEW',
        reason: 'Rejected: Not suitable',
      }),
    });
  });

  it('does not release capacity or write records when another request already changed the allocation', async () => {
    tx.allocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reject('allocation-1', 'admin-1', 'ADMIN', 'Not suitable'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.trainingBatch.updateMany).not.toHaveBeenCalled();
    expect(tx.adminDecision.create).not.toHaveBeenCalled();
    expect(tx.workflowAuditLog.create).not.toHaveBeenCalled();
  });

  it('aborts the rejection when the training batch has no seat to release', async () => {
    tx.trainingBatch.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reject('allocation-1', 'admin-1', 'ADMIN', 'Not suitable'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.adminDecision.create).not.toHaveBeenCalled();
    expect(tx.workflowAuditLog.create).not.toHaveBeenCalled();
  });
});
