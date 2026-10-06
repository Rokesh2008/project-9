import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

describe('Member 2 – Allocation workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cycleId: string;
  let domainAiMl: string;
  let domainDs: string;
  let domainMern: string;
  let batchAiMl: string;
  let batchDs: string;
  let batchMern: string;
  let studentId1: string;
  let studentId2: string;
  let studentId3: string;
  let departmentId: string;
  let batchId: string;
  let programId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/project9_test';
    process.env.AUTH_REQUIRED = 'false';
    process.env.DEMO_MODE = 'true';
    process.env.STATE_FILE = `/tmp/project9-alloc-test-${process.pid}.json`;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    prisma = module.get(PrismaService);
    await app.init();
  });

  beforeEach(async () => {
    await prisma.workflowAuditLog.deleteMany();
    await prisma.adminDecision.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.studentPreference.deleteMany();
    await prisma.studentCycleStatus.deleteMany();
    await prisma.assessmentResult.deleteMany();
    await prisma.trainingBatch.deleteMany();
    await prisma.domain.deleteMany();
    await prisma.program.deleteMany();
    await prisma.selectionCycle.deleteMany();
    await prisma.student.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.department.deleteMany();

    const dept = await prisma.department.create({ data: { code: 'CSE', name: 'Computer Science' } });
    departmentId = dept.id;
    const batch = await prisma.batch.create({ data: { batchIdentifier: 'CSE-2026', academicYear: '2026', departmentId } });
    batchId = batch.id;
    const program = await prisma.program.create({ data: { code: 'PEP', name: 'Professional Enhancement Program' } });
    programId = program.id;

    const dAiMl = await prisma.domain.create({ data: { programId, code: 'PEPC-01', name: 'AI/ML' } });
    const dDs = await prisma.domain.create({ data: { programId, code: 'PEPC-05', name: 'Data Science' } });
    const dMern = await prisma.domain.create({ data: { programId, code: 'PEPC-06', name: 'Full Stack MERN' } });
    domainAiMl = dAiMl.id;
    domainDs = dDs.id;
    domainMern = dMern.id;

    const bAiMl = await prisma.trainingBatch.create({ data: { domainId: domainAiMl, batchCode: 'AI-B1', batchName: 'AI Batch 1', maxCapacity: 2, currentAllocated: 0 } });
    const bDs = await prisma.trainingBatch.create({ data: { domainId: domainDs, batchCode: 'DS-B1', batchName: 'DS Batch 1', maxCapacity: 2, currentAllocated: 0 } });
    const bMern = await prisma.trainingBatch.create({ data: { domainId: domainMern, batchCode: 'MERN-B1', batchName: 'MERN Batch 1', maxCapacity: 2, currentAllocated: 0 } });
    batchAiMl = bAiMl.id;
    batchDs = bDs.id;
    batchMern = bMern.id;

    const cycle = await prisma.selectionCycle.create({
      data: { code: 'CYCLE-2026-1', name: 'Test Cycle', academicPeriod: '2026', startDate: new Date(), endDate: new Date(Date.now() + 86400000) },
    });
    cycleId = cycle.id;

    const s1 = await prisma.student.create({ data: { studentId: 'STU-001', name: 'Alice', email: 'alice@test.com', batchId } });
    const s2 = await prisma.student.create({ data: { studentId: 'STU-002', name: 'Bob', email: 'bob@test.com', batchId } });
    const s3 = await prisma.student.create({ data: { studentId: 'STU-003', name: 'Charlie', email: 'charlie@test.com', batchId } });
    studentId1 = s1.id;
    studentId2 = s2.id;
    studentId3 = s3.id;

    await prisma.studentCycleStatus.createMany({
      data: [
        { studentId: studentId1, selectionCycleId: cycleId, currentState: 'SELECTION' },
        { studentId: studentId2, selectionCycleId: cycleId, currentState: 'SELECTION' },
        { studentId: studentId3, selectionCycleId: cycleId, currentState: 'SELECTION' },
      ],
    });

    await prisma.studentPreference.createMany({
      data: [
        { studentId: studentId1, selectionCycleId: cycleId, domainId: domainAiMl, preferenceRank: 1 },
        { studentId: studentId1, selectionCycleId: cycleId, domainId: domainDs, preferenceRank: 2 },
        { studentId: studentId2, selectionCycleId: cycleId, domainId: domainAiMl, preferenceRank: 1 },
        { studentId: studentId2, selectionCycleId: cycleId, domainId: domainMern, preferenceRank: 2 },
        { studentId: studentId3, selectionCycleId: cycleId, domainId: domainAiMl, preferenceRank: 1 },
        { studentId: studentId3, selectionCycleId: cycleId, domainId: domainDs, preferenceRank: 2 },
        { studentId: studentId3, selectionCycleId: cycleId, domainId: domainMern, preferenceRank: 3 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.workflowAuditLog.deleteMany();
    await prisma.adminDecision.deleteMany();
    await prisma.allocation.deleteMany();
    await prisma.studentPreference.deleteMany();
    await prisma.studentCycleStatus.deleteMany();
    await prisma.assessmentResult.deleteMany();
    await prisma.trainingBatch.deleteMany();
    await prisma.domain.deleteMany();
    await prisma.program.deleteMany();
    await prisma.selectionCycle.deleteMany();
    await prisma.student.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.department.deleteMany();
    await app.close();
  });

  it('allocates first preference when capacity is available', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    expect(res.body.totalProcessed).toBe(3);
    const alice = res.body.results.find((r: any) => r.studentId === studentId1);
    expect(alice.status).toBe('PENDING_APPROVAL');
    expect(alice.domainCode).toBe('PEPC-01');
    expect(alice.preferenceRank).toBe(1);
  });

  it('falls back to second preference when first is full', async () => {
    await prisma.trainingBatch.update({ where: { id: batchAiMl }, data: { maxCapacity: 2 } });

    const res = await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const aiMlAllocations = res.body.results.filter((r: any) => r.domainCode === 'PEPC-01');
    expect(aiMlAllocations.length).toBe(2);

    const charlie = res.body.results.find((r: any) => r.studentId === studentId3);
    expect(charlie.domainCode).not.toBe('PEPC-01');
  });

  it('marks MANUAL_REVIEW when all preferences are full', async () => {
    await prisma.trainingBatch.update({ where: { id: batchAiMl }, data: { maxCapacity: 0 } });
    await prisma.trainingBatch.update({ where: { id: batchDs }, data: { maxCapacity: 0 } });
    await prisma.trainingBatch.update({ where: { id: batchMern }, data: { maxCapacity: 0 } });

    const res = await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    expect(res.body.manualReview).toBe(3);
    expect(res.body.results.every((r: any) => r.status === 'MANUAL_REVIEW')).toBe(true);
  });

  it('prevents duplicate allocation for same student', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    expect(res2.body.skipped).toBe(3);
  });

  it('admin can approve an allocation', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const allocations = await prisma.allocation.findMany({ where: { selectionCycleId: cycleId } });
    const alloc = allocations[0];

    const res = await request(app.getHttpServer())
      .post(`/api/allocations/${alloc.id}/approve`)
      .set('x-role', 'ADMIN')
      .set('x-actor-id', 'admin-1')
      .send({ actorId: 'admin-1', reason: 'Looks good' })
      .expect(201);

    expect(res.body.status).toBe('APPROVED');
    expect(res.body.isFinalized).toBe(true);
  });

  it('unauthorized user cannot approve', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const allocations = await prisma.allocation.findMany({ where: { selectionCycleId: cycleId } });

    await request(app.getHttpServer())
      .post(`/api/allocations/${allocations[0].id}/approve`)
      .set('x-role', 'STUDENT')
      .send({ actorId: 'student-1', reason: 'Self approve' })
      .expect(403);
  });

  it('rejected allocation has correct status', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const allocations = await prisma.allocation.findMany({ where: { selectionCycleId: cycleId } });

    const res = await request(app.getHttpServer())
      .post(`/api/allocations/${allocations[0].id}/reject`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1', reason: 'Not suitable' })
      .expect(201);

    expect(res.body.status).toBe('REJECTED');
  });

  it('frozen allocation cannot be modified', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const allocations = await prisma.allocation.findMany({ where: { selectionCycleId: cycleId } });
    const alloc = allocations[0];

    await request(app.getHttpServer())
      .post(`/api/allocations/${alloc.id}/approve`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1', reason: 'Approved' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/allocations/${alloc.id}/freeze`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/allocations/${alloc.id}/approve`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1', reason: 'Re-approve' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/allocations/${alloc.id}/reject`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1', reason: 'Reject frozen' })
      .expect(400);
  });

  it('creates audit events for allocation actions', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const auditLogs = await prisma.workflowAuditLog.findMany({
      where: { selectionCycleId: cycleId },
    });

    expect(auditLogs.length).toBeGreaterThanOrEqual(3);

    const allocations = await prisma.allocation.findMany({ where: { selectionCycleId: cycleId } });

    await request(app.getHttpServer())
      .post(`/api/allocations/${allocations[0].id}/approve`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1', reason: 'Good' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/allocations/${allocations[0].id}/freeze`)
      .set('x-role', 'ADMIN')
      .send({ actorId: 'admin-1' })
      .expect(201);

    const allAudit = await prisma.workflowAuditLog.findMany({
      where: { selectionCycleId: cycleId },
      orderBy: { createdAt: 'asc' },
    });

    expect(allAudit.length).toBeGreaterThanOrEqual(5);

    const decisions = await prisma.adminDecision.findMany({
      where: { selectionCycleId: cycleId },
    });
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  it('capacity is never exceeded', async () => {
    await prisma.trainingBatch.update({ where: { id: batchAiMl }, data: { maxCapacity: 1 } });

    const res = await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const aiMlAllocations = res.body.results.filter((r: any) => r.domainCode === 'PEPC-01');
    expect(aiMlAllocations.length).toBeLessThanOrEqual(1);

    const batch = await prisma.trainingBatch.findUnique({ where: { id: batchAiMl } });
    expect(batch!.currentAllocated).toBeLessThanOrEqual(batch!.maxCapacity);
  });

  it('returns allocation for a specific student', async () => {
    await request(app.getHttpServer())
      .post('/api/allocations/generate')
      .set('x-actor-id', 'admin-1')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/allocations/${studentId1}`)
      .expect(200);

    expect(res.body.studentId).toBe(studentId1);
    expect(res.body.student).toBeDefined();
    expect(res.body.domain).toBeDefined();
  });
});
