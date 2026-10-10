import { OfficialReadService } from '../src/official-read.service';
import { PrismaService } from '../src/common/prisma.service';
import { Store } from '../src/store';

describe('Grouped capacity projection', () => {
  it('uses two aggregate queries, preserves empty domains and excludes rejected allocations', async () => {
    const prisma = {
      domain: { findMany: jest.fn().mockResolvedValue([
        { id: 'a', code: 'AI', name: 'Artificial Intelligence', trainingBatches: [{ maxCapacity: 2 }, { maxCapacity: 3 }] },
        { id: 'b', code: 'DS', name: 'Data Science', trainingBatches: [] },
      ]) },
      studentPreference: { groupBy: jest.fn().mockResolvedValue([{ domainId: 'a', _count: { _all: 6 } }]) },
      allocation: { groupBy: jest.fn().mockResolvedValue([{ domainId: 'a', _count: { _all: 2 } }]) },
    };
    const service = new OfficialReadService(prisma as unknown as PrismaService, {} as Store);
    jest.spyOn(service, 'enabled').mockReturnValue(true);
    jest.spyOn(service as any, 'latestCycle').mockResolvedValue({ id: 'cycle' });
    expect(await service.domainCapacity()).toEqual([
      { domain: 'AI Artificial Intelligence', capacity: 5, demand: 6, allocated: 2, available: 3, overSubscribed: true },
      { domain: 'DS Data Science', capacity: 0, demand: 0, allocated: 0, available: 0, overSubscribed: false },
    ]);
    expect(prisma.studentPreference.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.allocation.groupBy).toHaveBeenCalledWith({
      by: ['domainId'], where: { selectionCycleId: 'cycle', status: { not: 'REJECTED' } }, _count: { _all: true },
    });
  });
});
