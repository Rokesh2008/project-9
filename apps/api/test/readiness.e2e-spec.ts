import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { AuthService } from '../src/auth/auth.service';

describe('Score-only readiness import and student profiles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let studentId: string;
  let departmentId: string;
  let studentToken: string;
  let adminToken: string;
  const originalEnv = { ...process.env };
  const record = { registerNumber: 'READINESS-TEST-0001', sourceResultId: 'result-v1', assessedAt: '2026-10-07T00:00:00Z', readinessScore: 0, verificationStatus: 'VERIFIED', parameterScores: [{ parameterKey: 'monthly_coding_assessment', rawScore: 0, verificationStatus: 'VERIFIED' }] };
  const endpoint = '/api/integrations/project2/readiness';

  beforeAll(async () => {
    Object.assign(process.env, { AUTH_REQUIRED: 'true', AUTH_TOKEN_SECRET: 'test-readiness-secret-at-least-thirty-two-characters', INTEGRATION_API_KEY: 'readiness-integration-test-key', PERSISTENCE_DRIVER: 'file', DEMO_MODE: 'false', STATE_FILE: `/tmp/project9-readiness-test-${process.pid}.json` });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    prisma = module.get(PrismaService);
    const auth = module.get(AuthService);
    await app.init();
    const department = await prisma.department.create({ data: { code: 'READINESS-TEST', name: 'Synthetic readiness tests' } });
    departmentId = department.id;
    const batch = await prisma.batch.create({ data: { departmentId, batchIdentifier: 'READINESS-TEST-BATCH', academicYear: '2026', status: 'ACTIVE' } });
    const student = await prisma.student.create({ data: { studentId: 'READINESS-TEST-0001', registerNumber: record.registerNumber, name: 'Synthetic Readiness Student', batchId: batch.id } });
    studentId = student.id;
    const user = await prisma.user.create({ data: { email: 'readiness-student@example.test', name: 'Synthetic Readiness Student', password: auth.hashPassword('test-only-password'), role: 'STUDENT', studentId } });
    const admin = await prisma.user.create({ data: { email: 'readiness-admin@example.test', name: 'Synthetic Admin', password: auth.hashPassword('test-only-password'), role: 'ADMIN' } });
    studentToken = (await auth.login(user.email, 'test-only-password')).accessToken;
    adminToken = (await auth.login(admin.email, 'test-only-password')).accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ['readiness-student@example.test', 'readiness-admin@example.test'] } } });
    await prisma.student.delete({ where: { id: studentId } });
    await prisma.batch.deleteMany({ where: { departmentId } });
    await prisma.department.delete({ where: { id: departmentId } });
    await app.close();
    for (const key of ['AUTH_REQUIRED', 'AUTH_TOKEN_SECRET', 'INTEGRATION_API_KEY', 'PERSISTENCE_DRIVER', 'DEMO_MODE', 'STATE_FILE']) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
  });

  it('shows 12 pending rows even before a student joins a cycle', async () => {
    const response = await request(app.getHttpServer()).get('/api/profiles/me').set('Authorization', `Bearer ${studentToken}`).expect(200);
    expect(response.body.readiness.score).toBeNull();
    expect(response.body.readiness.parameters).toHaveLength(12);
  });

  it('imports marks without overwriting roster details or enrolling/scoring the student', async () => {
    await request(app.getHttpServer()).post(endpoint).set('x-integration-api-key', 'readiness-integration-test-key').set('Idempotency-Key', 'readiness-test-v1').send({ sourceBatchId: 'readiness-test', records: [record] }).expect(201, { inserted: 1, ignoredDuplicates: 0, updatedRoster: false, recalculatedSelection: false });
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.name).toBe('Synthetic Readiness Student');
    expect(student.cgpa).toBeNull();
    expect(await prisma.studentCycleStatus.count({ where: { studentId } })).toBe(0);
    const profile = await request(app.getHttpServer()).get('/api/profiles/me').set('Authorization', `Bearer ${studentToken}`).expect(200);
    expect(profile.body.readiness.score).toBe(0);
    expect(profile.body.readiness.parameters.find((item: any) => item.key === 'monthly_coding_assessment')).toMatchObject({ rawScore: 0, verificationStatus: 'VERIFIED' });
    expect(profile.body.readiness.parameters.filter((item: any) => item.rawScore === null)).toHaveLength(11);
  });

  it('replays an identical result without duplicate rows', async () => {
    const response = await request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'readiness-test-v1').send({ sourceBatchId: 'readiness-test', records: [record] }).expect(201);
    expect(response.body.ignoredDuplicates).toBe(1);
    expect(await prisma.readinessAssessment.count({ where: { studentId } })).toBe(1);
  });

  it('rejects corrections to an immutable result ID', async () => {
    await request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'different-key').send({ sourceBatchId: 'readiness-test', records: [{ ...record, readinessScore: 1 }] }).expect(409);
  });

  it('rolls back the batch if a later register number does not exist', async () => {
    await request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', 'bad-batch').send({ sourceBatchId: 'test', records: [{ ...record, sourceResultId: 'would-have-inserted' }, { ...record, registerNumber: 'DOES-NOT-EXIST' }] }).expect(400);
    expect(await prisma.readinessAssessment.count({ where: { studentId } })).toBe(1);
  });

  it('rejects unauthenticated/student imports and missing replay headers', async () => {
    const body = { sourceBatchId: 'test', records: [record] };
    await request(app.getHttpServer()).post(endpoint).send(body).expect(401);
    await request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${studentToken}`).send(body).expect(403);
    await request(app.getHttpServer()).post(endpoint).set('Authorization', `Bearer ${adminToken}`).send(body).expect(400);
    await request(app.getHttpServer()).get('/api/profiles/READINESS-TEST-0001').set('Authorization', `Bearer ${studentToken}`).expect(403);
  });
});
