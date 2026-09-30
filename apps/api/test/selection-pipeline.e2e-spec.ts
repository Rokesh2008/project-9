import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

describe('Integrated selection pipeline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cycleId: string;

  beforeAll(async () => {
    process.env.PERSISTENCE_DRIVER = 'postgres';
    process.env.OFFICIAL_PROJECTION = 'true';
    process.env.AUTH_REQUIRED = 'false';
    process.env.DEMO_MODE = 'false';
    process.env.STATE_FILE = `/tmp/project9-pipeline-${process.pid}.json`;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    prisma = module.get(PrismaService);
    await app.init();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE',
    );

    const cycle = await prisma.selectionCycle.create({
      data: {
        code: 'PIPELINE-2026',
        name: 'Pipeline Test Cycle',
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
        createdBy: 'test',
        isActive: true,
        rules: {
          logic: 'AND',
          rules: [
            {
              id: 'coding-gate',
              field: 'codingScore',
              operator: 'GTE',
              value: 70,
            },
          ],
        },
      },
    });

    const weightVersion = await prisma.weightVersion.create({
      data: {
        selectionCycleId: cycleId,
        version: 1,
        createdBy: 'test',
        weights: {
          create: [
            {
              parameterKey: 'coding',
              parameterLabel: 'Coding',
              weight: 1,
              maxRawScore: 100,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    await prisma.cycleConfig.create({
      data: {
        selectionCycleId: cycleId,
        activeWeightVersionId: weightVersion.id,
        eligibilityRuleVersionId: rule.id,
        hopeCount: 1,
        pepCount: 1,
      },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE',
    );
    await app.close();
    delete process.env.PERSISTENCE_DRIVER;
    delete process.env.OFFICIAL_PROJECTION;
    delete process.env.AUTH_REQUIRED;
    delete process.env.DEMO_MODE;
  });

  it('scores, evaluates, ranks and classifies the cycle in one run', async () => {
    const records = [
      ['S-001', 'REG001', 'Alice', 90],
      ['S-002', 'REG002', 'Bob', 80],
      ['S-003', 'REG003', 'Cara', 75],
    ].map(([studentId, registerNumber, name, codingScore]) => ({
      studentId,
      registerNumber,
      name,
      department: 'CSE',
      batchIdentifier: 'CSE-2026',
      academicYear: '2026',
      cgpa: 8,
      codingScore,
      aptitudeScore: 70,
      attendancePercent: 90,
      dsaLevel: 'INTERMEDIATE',
      preferences: [],
      completedCertificates: [],
      program: 'UNASSIGNED',
      sourceUpdatedAt: '2026-09-30T00:00:00.000Z',
    }));

    await request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'pipeline-project2')
      .send({
        selectionCycleId: cycleId,
        sourceBatchId: 'P2-PIPELINE',
        records,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/selection-pipeline/run')
      .set('x-actor-id', 'pipeline-test')
      .send({ selectionCycleId: cycleId })
      .expect(201);

    expect(response.body.scored).toBe(3);
    expect(response.body.eligibilityEvaluated).toBe(3);
    expect(response.body.ranked).toBe(3);
    expect(response.body.classified).toBe(3);
    expect(response.body.selected).toBe(2);
    expect(response.body.waitlisted).toBe(1);
    expect(response.body.ineligible).toBe(0);

    const classifications = await prisma.hopePepClassification.findMany({
      where: { selectionCycleId: cycleId },
      orderBy: { rank: 'asc' },
      include: { student: true },
    });

    expect(classifications.map((x) => [x.student.studentId, x.program])).toEqual([
      ['S-001', 'HOPE'],
      ['S-002', 'PEP'],
      ['S-003', 'WAITLIST'],
    ]);

    const rankings = await prisma.studentRanking.findMany({
      where: { selectionCycleId: cycleId },
      orderBy: { rank: 'asc' },
    });
    expect(rankings.map((x) => x.totalScore)).toEqual([90, 80, 75]);

    const workflow = await prisma.studentCycleStatus.findMany({
      where: { selectionCycleId: cycleId },
      include: { student: true },
    });
    const states = Object.fromEntries(
      workflow.map((item) => [item.student.studentId, item.currentState]),
    );
    expect(states).toEqual({
      'S-001': 'COMMUNICATION',
      'S-002': 'COMMUNICATION',
      'S-003': 'HOPE_PEP',
    });
  });
});
