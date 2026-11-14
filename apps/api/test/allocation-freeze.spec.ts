import { BadRequestException } from '@nestjs/common';
import { AllocationService } from '../src/allocation/allocation.service';

describe('AllocationService.freeze', () => {
  const allocation = {
    id: 'allocation-1',
    studentId: 'student-1',
    selectionCycleId: 'cycle-1',
    domainId: 'domain-1',
    trainingBatchId: 'batch-1',
    status: 'APPROVED',
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
          status: 'FROZEN',
          isFrozen: true,
          frozenBy: 'admin-1',
        }),
      },
      studentCycleStatus: { findUnique: jest.fn().mockResolvedValue({ id: 'cycle-status-1' }) },
      workflowAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      allocation: { findUnique: jest.fn().mockResolvedValue(allocation) },
      $transaction: jest.fn(async (callback: (client: any) => Promise<unknown>) => callback(tx)),
    };
    service = new AllocationService(prisma as any);
  });

  it('freezes the allocation and writes the audit record in one transaction', async () => {
    const result = await service.freeze('allocation-1', 'admin-1', 'ADMIN');

    expect(result).toMatchObject({ id: 'allocation-1', status: 'FROZEN', isFrozen: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.allocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'allocation-1', status: 'APPROVED', isFrozen: false },
      data: expect.objectContaining({
        status: 'FROZEN',
        isFrozen: true,
        frozenBy: 'admin-1',
      }),
    }));
    expect(tx.workflowAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        selectionCycleId: 'cycle-1',
        fromState: 'FINALIZED',
        toState: 'FROZEN',
        actor: 'admin-1',
        role: 'ADMIN',
        reason: 'Allocation frozen',
      }),
    });
  });

  it('does not write an audit record when another request wins the freeze race', async () => {
    tx.allocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.freeze('allocation-1', 'admin-1', 'ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.workflowAuditLog.create).not.toHaveBeenCalled();
  });

  it('preserves the requirement that only approved allocations can be frozen', async () => {
    prisma.allocation.findUnique.mockResolvedValue({ ...allocation, status: 'REJECTED' });

    await expect(
      service.freeze('allocation-1', 'admin-1', 'ADMIN'),
    ).rejects.toThrow('Only approved allocations can be frozen');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
