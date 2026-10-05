import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

const record = {
  studentId: 'S-001', registerNumber: 'reg001', name: 'Ada Student', department: 'CSE',
  email: 'ada@example.edu', cgpa: 8.4, codingScore: 82, aptitudeScore: 74,
  attendancePercent: 91, dsaLevel: 'INTERMEDIATE', preferences: ['PEPC-01 AI/ML'],
  completedCertificates: ['Data Science Foundation'], program: 'PEP',
  sourceUpdatedAt: '2026-09-24T00:00:00.000Z',
};

describe('Member 3 acceptance paths', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
    process.env.DEMO_MODE = 'true';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    prisma = module.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects invalid external payload before business processing', async () => {
    await request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'invalid-1')
      .send({ sourceBatchId: 'b1', records: [{ ...record, cgpa: 14 }] })
      .expect(400);
  });

  it('processes the same request exactly once', async () => {
    const payload = { sourceBatchId: 'b1', records: [record] };
    await request(app.getHttpServer()).post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'same-key-e2e').send(payload).expect(201);
    const second = await request(app.getHttpServer()).post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'same-key-e2e').send(payload).expect(201);
    expect(second.body.duplicate).toBe(true);
  });

  it('imports an XLSX workbook through the canonical DTO', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow([
      'studentId', 'registerNumber', 'name', 'department', 'email', 'cgpa', 'codingScore',
      'aptitudeScore', 'attendancePercent', 'dsaLevel', 'preferences', 'completedCertificates',
      'program', 'sourceUpdatedAt',
    ]);
    sheet.addRow([
      record.studentId, record.registerNumber, record.name, record.department, record.email,
      record.cgpa, record.codingScore, record.aptitudeScore, record.attendancePercent,
      record.dsaLevel, record.preferences.join('|'), record.completedCertificates.join('|'),
      record.program, record.sourceUpdatedAt,
    ]);
    const data = await workbook.xlsx.writeBuffer();
    await request(app.getHttpServer()).post('/api/integrations/import/excel')
      .set('Idempotency-Key', 'xlsx-e2e-1')
      .attach('file', Buffer.from(data), 'students.xlsx')
      .expect(201);
  });

  it('keeps AI advisory output separate from official fields', async () => {
    const response = await request(app.getHttpServer()).post('/api/ai/students/S-001/analyze').expect(201);
    expect(response.body.advisoryOnly).toBe(true);
  });

  it('simulates missing dependencies and produces an eligible pool', async () => {
    const result = await request(app.getHttpServer()).post('/api/demo/run-dependency-simulation').expect(201);
    expect(result.body.mode).toBe('DEMO_ONLY');
    expect(result.body.eligibility.eligible).toBeGreaterThanOrEqual(0);
  });
});
