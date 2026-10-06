import { validate } from 'class-validator';
import { AuthService, AuthPrincipal } from '../src/auth/auth.service';
import { LoginDto, BootstrapAdminDto } from '../src/auth/auth.dto';
import { ProfilesService } from '../src/profiles/profiles.service';

const { parseRows } = require('../scripts/import-second-year.cjs');

describe('Second-year roster accounts', () => {
  const originalSecret = process.env.AUTH_TOKEN_SECRET;
  beforeAll(() => { process.env.AUTH_TOKEN_SECRET = 'roster-test-secret-long-enough-for-signing'; });
  afterAll(() => { process.env.AUTH_TOKEN_SECRET = originalSecret; });

  function setup() {
    const prisma = {
      user: { findUnique: jest.fn() },
      student: { findUnique: jest.fn() },
    };
    const auth = new AuthService(prisma as any);
    const user = { id: 'user-1', email: '312325000001@students.project9.local', name: 'Roster Student',
      role: 'STUDENT', studentId: 'student-1', isActive: true, authVersion: 0, password: auth.hashPassword('temp123') };
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1', isActive: true, user });
    return { prisma, auth, user };
  }

  it('accepts register numbers and existing short passwords at login, but preserves admin creation validation', async () => {
    expect(await validate(Object.assign(new LoginDto(), { email: '312325000001', password: 'temp123' }))).toHaveLength(0);
    expect((await validate(Object.assign(new BootstrapAdminDto(), { name: 'Admin', email: '312325000001', password: 'temp123' }))).length).toBeGreaterThan(0);
  });

  it('resolves a register number only to its linked student account', async () => {
    const { prisma, auth } = setup();
    const result = await auth.login(' 312325000001 ', 'temp123');
    expect(result.user.studentId).toBe('student-1');
    expect(auth.verifyToken(result.accessToken).role).toBe('STUDENT');
    expect(prisma.student.findUnique).toHaveBeenCalledWith({ where: { registerNumber: '312325000001' }, include: { user: true } });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    await expect(auth.login('312325000001', 'wrong')).rejects.toThrow('Invalid login ID or password');
  });

  it('accepts alphanumeric register IDs and rejects inactive or non-student bindings', async () => {
    const { prisma, auth, user } = setup();
    await auth.login('25lit999', 'temp123');
    expect(prisma.student.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { registerNumber: '25LIT999' } }));
    prisma.student.findUnique.mockResolvedValue({ isActive: false, user });
    await expect(auth.login('25LIT999', 'temp123')).rejects.toThrow();
    prisma.student.findUnique.mockResolvedValue({ isActive: true, user: { ...user, role: 'ADMIN' } });
    await expect(auth.login('25LIT999', 'temp123')).rejects.toThrow();
    prisma.student.findUnique.mockResolvedValue({ isActive: true, user: { ...user, isActive: false } });
    await expect(auth.login('25LIT999', 'temp123')).rejects.toThrow();
  });

  it('preserves faculty/admin email login', async () => {
    const { prisma, auth, user } = setup();
    prisma.user.findUnique.mockResolvedValue({ ...user, role: 'ADMIN', email: 'admin@test.local' });
    expect((await auth.login(' Admin@Test.Local ', 'temp123')).user.role).toBe('ADMIN');
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it('shows missing assessment data without inventing scores or selection decisions', async () => {
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', studentId: '312325000001', name: 'Roster Student',
        registerNumber: '312325000001', batch: { batchIdentifier: 'SJCE-II-2026-2027-CSE', department: { name: 'CSE' } } }) },
      studentCycleStatus: { findFirst: jest.fn().mockResolvedValue(null) },
      assessmentResult: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const profile = await new ProfilesService(prisma as any).mine({ role: 'STUDENT', studentId: 'student-1' } as AuthPrincipal);
    expect(profile.outcome).toBe('NOT_IN_CYCLE');
    expect(profile).toMatchObject({ assessmentStatus: 'PENDING', cycle: null, scoreBreakdown: [] });
    expect(profile.ranking).toBeUndefined();
    expect(profile.classification).toBeUndefined();
    expect(profile.timeline[0].state).toBe('DONE');
    expect(profile.timeline.slice(1).every(step => step.state === 'PENDING')).toBe(true);
  });

  it('deduplicates identical identities but refuses conflicting duplicates or missing IDs', () => {
    const header = ['Sl.No', 'Register Number', 'Name of the Student', 'Dept', 'College'];
    const row = [1, 312325000001, 'Roster Student', 'CSE', "St JOSEPH'S ENGINEERING"];
    expect(parseRows([header, row, [2, ...row.slice(1)]]).duplicates).toBe(1);
    expect(() => parseRows([header, row, [2, 312325000001, 'Different Student', 'CSE', row[4]]])).toThrow('Conflicting duplicate');
    expect(() => parseRows([header, [1, '', 'Roster Student', 'CSE', row[4]]])).toThrow('Invalid student identity');
    expect(parseRows([header, [1, '25LIT999', 'Roster Student', 'IT', 'TECHNOLOGY']]).records[0].college).toBe('SJCT');
  });
});
