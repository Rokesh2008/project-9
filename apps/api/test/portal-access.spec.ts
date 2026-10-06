import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService, AuthPrincipal } from '../src/auth/auth.service';
import { AllocationService } from '../src/allocation/allocation.service';
import { AgentService } from '../src/agent.service';

const student: AuthPrincipal = {
  sub: 'user-student', email: 'student@example.com', role: 'STUDENT',
  studentId: 'internal-student', iat: 1, exp: 9999999999,
};
const faculty: AuthPrincipal = {
  sub: 'user-faculty', email: 'faculty@example.com', role: 'PEP_STAFF',
  facultyDomainId: 'domain-data', iat: 1, exp: 9999999999,
};

function context(path: string, method = 'GET') {
  const request = { path, method, headers: { authorization: 'Bearer token' } as Record<string, string>, user: undefined as unknown };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
}

describe('Role-scoped portals', () => {
  const originalAuthRequired = process.env.AUTH_REQUIRED;
  beforeEach(() => { process.env.AUTH_REQUIRED = 'true'; });
  afterAll(() => { process.env.AUTH_REQUIRED = originalAuthRequired; });

  it('permits a student to fetch only their own profile route', async () => {
    const auth = { extractBearer: jest.fn().mockReturnValue(student), resolvePrincipal: jest.fn().mockResolvedValue(student) };
    const guard = new AuthGuard(auth as unknown as AuthService);
    expect(await guard.canActivate(context('/api/profiles/me').context)).toBe(true);
    await expect(guard.canActivate(context('/api/students').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('/api/profiles/CSV-004').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('/api/profiles/roster-allocations').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('/api/accounts').context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets faculty read all profiles but restricts mutation and account management', async () => {
    const auth = { extractBearer: jest.fn().mockReturnValue(faculty), resolvePrincipal: jest.fn().mockResolvedValue(faculty) };
    const guard = new AuthGuard(auth as unknown as AuthService);
    expect(await guard.canActivate(context('/api/allocations').context)).toBe(true);
    expect(await guard.canActivate(context('/api/profiles').context)).toBe(true);
    expect(await guard.canActivate(context('/api/profiles/CSV-008').context)).toBe(true);
    expect(await guard.canActivate(context('/api/agent/selection/recommendations/rec-1/decision', 'POST').context)).toBe(true);
    await expect(guard.canActivate(context('/api/students').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('/api/agent/selection/run', 'POST').context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('/api/accounts').context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('filters faculty allocations and rejects cross-domain approval', async () => {
    const prisma = {
      allocation: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'alloc-ai', domainId: 'domain-ai', status: 'PENDING_APPROVAL', isFrozen: false }),
        update: jest.fn(),
      },
    };
    const service = new AllocationService(prisma as any);
    await service.findAll(undefined, faculty);
    expect(prisma.allocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { domainId: 'domain-data' } }));
    await expect(service.approve('alloc-ai', faculty.sub, faculty.role, 'reviewed', faculty.facultyDomainId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.allocation.update).not.toHaveBeenCalled();
  });

  it('filters faculty recommendations and rejects a cross-domain decision', async () => {
    const recommendations = new Map([
      ['data', { id: 'data', studentId: 'CSV-004', recommendedDomain: 'PEPC-05 Data Science', status: 'PENDING_APPROVAL' }],
      ['ai', { id: 'ai', studentId: 'CSV-001', recommendedDomain: 'PEPC-01 AI/ML', status: 'PENDING_APPROVAL' }],
    ]);
    const prisma = { domain: { findUnique: jest.fn().mockResolvedValue({ code: 'PEPC-05' }) } };
    const store = { recommendations, auditEvents: [], persist: jest.fn() };
    const service = new AgentService(store as any, {} as any, prisma as any, {} as any);
    expect((await service.list(faculty)).map((r) => r.id)).toEqual(['data']);
    await expect(service.approve('ai', faculty.sub, 'REJECT', faculty)).rejects.toBeInstanceOf(ForbiddenException);
    expect(recommendations.get('ai')?.status).toBe('PENDING_APPROVAL');
    await service.approve('data', faculty.sub, 'REJECT', faculty);
    expect(recommendations.get('data')?.status).toBe('REJECTED');
  });
});
