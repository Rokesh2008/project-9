import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { Store } from '../src/store';

describe('Official Project 2 -> 9 -> 1 -> 9 -> 8 integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: Store;
  let cycleId: string;

  beforeAll(async () => {
    process.env.PERSISTENCE_DRIVER = 'postgres';
    process.env.OFFICIAL_PROJECTION = 'true';
    process.env.DEMO_MODE = 'false';
    process.env.STATE_FILE = `/tmp/project9-official-integration-${process.pid}.json`;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    prisma = module.get(PrismaService);
    store = module.get(Store);
    await app.init();
  });

  beforeEach(async () => {
    store.reset();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE',
    );

    const program = await prisma.program.create({
      data: { code: 'PEP', name: 'Professional Enhancement Program' },
    });
    const domain = await prisma.domain.create({
      data: { programId: program.id, code: 'PEPC-01', name: 'AI/ML' },
    });
    await prisma.trainingBatch.create({
      data: {
        domainId: domain.id,
        batchCode: 'PEPC-01-B1',
        batchName: 'AI/ML Batch 1',
        maxCapacity: 5,
      },
    });

    const cycle = await prisma.selectionCycle.create({
      data: {
        code: 'OFFICIAL-2026',
        name: 'Official Integration Cycle',
        academicPeriod: '2026',
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    cycleId = cycle.id;

    const rule = await prisma.eligibilityRuleVersion.create({
      data: {
        selectionCycleId: cycleId,
        version: 1,
        isActive: true,
        createdBy: 'test',
        rules: {
          logic: 'AND',
          rules: [
            {
              id: 'communication-pass',
              field: 'communicationScore',
              operator: 'GTE',
              value: 50,
            },
          ],
        },
      },
    });

    await prisma.cycleConfig.create({
      data: {
        selectionCycleId: cycleId,
        hopeCount: 1,
        pepCount: 1,
        eligibilityRuleVersionId: rule.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE',
    );
    await app.close();
    delete process.env.OFFICIAL_PROJECTION;
    delete process.env.PERSISTENCE_DRIVER;
    delete process.env.DEMO_MODE;
  });

  async function importProject2() {
    return request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'official-p2-1')
      .send({
        selectionCycleId: cycleId,
        sourceBatchId: 'P2-OFFICIAL-1',
        records: [
          {
            studentId: 'EXT-001',
            registerNumber: '312325100001',
            name: 'Official Student',
            department: 'CSE',
            batchIdentifier: 'CSE-2026',
            academicYear: '2026',
            readinessScore: 174,
            email: 'official@student.test',
            cgpa: 8.4,
            codingScore: 82,
            aptitudeScore: 76,
            attendancePercent: 91,
            dsaLevel: 'INTERMEDIATE',
            preferences: ['PEPC-01 AI/ML'],
            completedCertificates: ['Data Science Foundation'],
            program: 'UNASSIGNED',
            sourceUpdatedAt: '2026-09-30T00:00:00.000Z',
          },
        ],
      })
      .expect(201);
  }

  it('projects Project 2 data into normalized official tables', async () => {
    const response = await importProject2();
    expect(response.body.official.mode).toBe('OFFICIAL');
    expect(response.body.official.projected).toBe(1);

    const student = await prisma.student.findUnique({ where: { studentId: 'EXT-001' } });
    expect(student?.registerNumber).toBe('312325100001');
    expect(student?.cgpa).toBe(8.4);

    const assessments = await prisma.assessmentResult.findMany({
      where: { studentId: student!.id },
    });
    expect(assessments.map((x) => x.assessmentType).sort()).toEqual(
      ['APTITUDE', 'CODING', 'OTHER'],
    );

    const certificate = await prisma.studentCredential.findFirst({
      where: { studentId: student!.id },
    });
    expect(certificate?.verificationStatus).toBe('VERIFIED');

    const preference = await prisma.studentPreference.findFirst({
      where: { studentId: student!.id, selectionCycleId: cycleId },
      include: { domain: true },
    });
    expect(preference?.domain.code).toBe('PEPC-01');
  });

  it('uses Project 1 result to re-evaluate official eligibility', async () => {
    await importProject2();

    const student = await prisma.student.findUniqueOrThrow({
      where: { studentId: 'EXT-001' },
    });
    await prisma.hopePepClassification.create({
      data: {
        studentId: student.id,
        selectionCycleId: cycleId,
        program: 'HOPE',
        rank: 1,
      },
    });

    const candidates = await request(app.getHttpServer())
      .get('/api/integrations/project1/candidates')
      .query({ selectionCycleId: cycleId })
      .expect(200);
    expect(candidates.body).toHaveLength(1);

    const response = await request(app.getHttpServer())
      .post('/api/integrations/project1/results')
      .set('Idempotency-Key', 'official-p1-1')
      .send({
        selectionCycleId: cycleId,
        sourceBatchId: 'P1-OFFICIAL-1',
        records: [
          {
            resultId: 'COMM-001',
            studentId: 'EXT-001',
            score: 72,
            level: 'READY',
            assessedAt: '2026-09-30T01:00:00.000Z',
          },
        ],
      })
      .expect(201);

    expect(response.body.official.reEvaluated).toBe(1);

    const eligibility = await prisma.eligibilityResult.findUnique({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
    });
    expect(eligibility?.isEligible).toBe(true);

    const state = await prisma.studentCycleStatus.findUnique({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
    });
    expect(state?.currentState).toBe('INTERVIEW');

    const interviewCandidates = await request(app.getHttpServer())
      .get('/api/integrations/project8/candidates')
      .query({ selectionCycleId: cycleId })
      .expect(200);
    expect(interviewCandidates.body).toHaveLength(1);
  });

  it('serves dashboard students and reports from official PostgreSQL state', async () => {
    await importProject2();

    const student = await prisma.student.findUniqueOrThrow({
      where: { studentId: 'EXT-001' },
    });
    await prisma.hopePepClassification.create({
      data: {
        studentId: student.id,
        selectionCycleId: cycleId,
        program: 'PEP',
        rank: 1,
      },
    });
    await prisma.studentCycleStatus.update({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
      data: { currentState: 'SELECTION' },
    });

    const students = await request(app.getHttpServer())
      .get('/api/students')
      .expect(200);
    expect(students.body).toHaveLength(1);
    expect(students.body[0].program).toBe('PEP');
    expect(students.body[0].selected).toBe(true);

    const summary = await request(app.getHttpServer())
      .get('/api/reports/selection-summary')
      .expect(200);
    expect(summary.body.totalStudents).toBe(1);
    expect(summary.body.selected).toBe(1);
    expect(summary.body.interviewEligible).toBe(1);

    const capacity = await request(app.getHttpServer())
      .get('/api/reports/domain-capacity')
      .expect(200);
    expect(capacity.body[0].domain).toContain('PEPC-01');
    expect(capacity.body[0].capacity).toBe(5);
  });

  it('applies an approved AI recommendation through the official allocation service', async () => {
    await importProject2();

    const student = await prisma.student.findUniqueOrThrow({
      where: { studentId: 'EXT-001' },
    });
    await prisma.hopePepClassification.create({
      data: {
        studentId: student.id,
        selectionCycleId: cycleId,
        program: 'PEP',
        rank: 1,
      },
    });

    const run = await request(app.getHttpServer())
      .post('/api/agent/selection/run')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    expect(run.body.recommendations).toHaveLength(1);
    const recommendationId = run.body.recommendations[0].id;

    const approved = await request(app.getHttpServer())
      .post(`/api/agent/selection/recommendations/${recommendationId}/decision`)
      .set('x-role', 'ADMIN')
      .send({ approverId: 'admin-1', decision: 'APPROVE' })
      .expect(201);

    expect(approved.body.status).toBe('VERIFIED');

    const allocation = await prisma.allocation.findUnique({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
      include: { domain: true },
    });
    expect(allocation?.status).toBe('APPROVED');
    expect(allocation?.domain?.code).toBe('PEPC-01');

    const audit = await prisma.workflowAuditLog.findFirst({
      where: { studentId: student.id, selectionCycleId: cycleId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.toState).toBe('FINALIZED');
  });

  it('routes HOPE interview failure to PEP, then second failure to admin review', async () => {
    await importProject2();

    const student = await prisma.student.findUniqueOrThrow({
      where: { studentId: 'EXT-001' },
    });
    await prisma.hopePepClassification.create({
      data: {
        studentId: student.id,
        selectionCycleId: cycleId,
        program: 'HOPE',
        rank: 1,
      },
    });

    await request(app.getHttpServer())
      .post('/api/integrations/project8/results')
      .set('Idempotency-Key', 'official-p8-1')
      .send({
        selectionCycleId: cycleId,
        sourceBatchId: 'P8-OFFICIAL-1',
        records: [
          {
            attemptId: 'INT-001',
            studentId: 'EXT-001',
            score: 55,
            outcome: 'FAIL',
            interviewedAt: '2026-09-30T02:00:00.000Z',
          },
        ],
      })
      .expect(201);

    let classification = await prisma.hopePepClassification.findUniqueOrThrow({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
    });
    expect(classification.program).toBe('PEP');
    expect(classification.status).toBe('PEP_FALLBACK_ALLOWED');

    await request(app.getHttpServer())
      .post('/api/integrations/project8/results')
      .set('Idempotency-Key', 'official-p8-2')
      .send({
        selectionCycleId: cycleId,
        sourceBatchId: 'P8-OFFICIAL-2',
        records: [
          {
            attemptId: 'INT-002',
            studentId: 'EXT-001',
            score: 58,
            outcome: 'FAIL',
            interviewedAt: '2026-09-30T03:00:00.000Z',
          },
        ],
      })
      .expect(201);

    classification = await prisma.hopePepClassification.findUniqueOrThrow({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
    });
    expect(classification.status).toBe('PEP_FALLBACK_DENIED');

    const state = await prisma.studentCycleStatus.findUniqueOrThrow({
      where: {
        studentId_selectionCycleId: {
          studentId: student.id,
          selectionCycleId: cycleId,
        },
      },
    });
    expect(state.currentState).toBe('ADMIN_REVIEW');
  });
});
