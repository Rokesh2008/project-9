import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { existsSync, unlinkSync } from 'fs';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { CanonicalStudent } from '../src/domain';
import { Store } from '../src/store';

const record = {
  studentId: 'S-001', registerNumber: 'reg001', name: 'Ada Student', department: 'CSE',
  email: 'ada@example.edu', cgpa: 8.4, codingScore: 82, aptitudeScore: 74,
  attendancePercent: 91, dsaLevel: 'INTERMEDIATE', preferences: ['PEPC-01 AI/ML'],
  completedCertificates: ['Data Science Foundation'], program: 'PEP',
  sourceUpdatedAt: '2026-09-24T00:00:00.000Z',
};

describe('Member 3 acceptance paths', () => {
  let app: INestApplication;
  let store: Store;

  beforeAll(async () => {
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
    process.env.DEMO_MODE = 'true';
    process.env.STATE_FILE = `/tmp/project9-member3-test-${process.pid}.json`;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    store = module.get(Store);
    await app.init();
  });

  beforeEach(() => store.reset());
  afterAll(async () => {
    await app.close();
    if (existsSync(process.env.STATE_FILE!)) unlinkSync(process.env.STATE_FILE!);
  });

  it('rejects invalid external payload before business processing', async () => {
    await request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'invalid-1')
      .send({ sourceBatchId: 'b1', records: [{ ...record, cgpa: 14 }] })
      .expect(400);
    expect(store.students.size).toBe(0);
  });

  it('processes the same request exactly once', async () => {
    const payload = { sourceBatchId: 'b1', records: [record] };
    await request(app.getHttpServer()).post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'same-key').send(payload).expect(201);
    const second = await request(app.getHttpServer()).post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'same-key').send(payload).expect(201);
    expect(second.body.duplicate).toBe(true);
    expect(store.students.size).toBe(1);
  });

  it('maps CSV and API imports to the same canonical DTO', async () => {
    await request(app.getHttpServer()).post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'api-1').send({ sourceBatchId: 'api', records: [record] }).expect(201);
    const fromApi = { ...store.students.get('S-001') };
    store.reset();
    const csv = [
      'studentId,registerNumber,name,department,email,cgpa,codingScore,aptitudeScore,attendancePercent,dsaLevel,preferences,completedCertificates,program,sourceUpdatedAt',
      'S-001,reg001,Ada Student,CSE,ada@example.edu,8.4,82,74,91,INTERMEDIATE,PEPC-01 AI/ML,Data Science Foundation,PEP,2026-09-24T00:00:00.000Z',
    ].join('\n');
    await request(app.getHttpServer()).post('/api/integrations/import/excel')
      .set('Idempotency-Key', 'csv-1').attach('file', Buffer.from(csv), 'students.csv').expect(201);
    expect(store.students.get('S-001')).toEqual(fromApi);
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
      .set('Idempotency-Key', 'xlsx-1')
      .attach('file', Buffer.from(data), 'students.xlsx')
      .expect(201);
    expect(store.students.get('S-001')?.registerNumber).toBe('REG001');
  });

  it('keeps AI advisory output separate from official fields', async () => {
    store.students.set('S-001', { ...record, registerNumber: 'REG001', interviewEligible: true, selected: false } as CanonicalStudent);
    const before = { ...store.students.get('S-001') };
    const response = await request(app.getHttpServer()).post('/api/ai/students/S-001/analyze').expect(201);
    expect(response.body.advisoryOnly).toBe(true);
    expect(store.students.get('S-001')).toEqual(before);
  });

  it('requires an authorized role before applying an agent recommendation', async () => {
    store.students.set('S-001', { ...record, registerNumber: 'REG001', interviewEligible: true, selected: true } as CanonicalStudent);
    const run = await request(app.getHttpServer()).post('/api/agent/selection/run').send({}).expect(201);
    const id = run.body.recommendations[0].id;
    await request(app.getHttpServer()).post(`/api/agent/selection/recommendations/${id}/decision`)
      .send({ approverId: 'A-1', decision: 'APPROVE' }).expect(403);
    const approved = await request(app.getHttpServer()).post(`/api/agent/selection/recommendations/${id}/decision`)
      .set('x-role', 'PLACEMENT_COORDINATOR').send({ approverId: 'A-1', decision: 'APPROVE' }).expect(201);
    expect(approved.body.status).toBe('VERIFIED');
    expect(store.allocations.get('S-001')).toBe('PEPC-01 AI/ML');
  });

  it('simulates missing dependencies and produces an eligible pool', async () => {
    const result = await request(app.getHttpServer()).post('/api/demo/run-dependency-simulation').expect(201);
    expect(result.body.mode).toBe('DEMO_ONLY');
    expect(result.body.eligibility.eligible).toBeGreaterThan(0);
    expect(result.body.project1.inserted).toBeGreaterThan(0);
    expect(result.body.project8.inserted).toBeGreaterThan(0);
    const agent = await request(app.getHttpServer()).post('/api/agent/selection/run').send({}).expect(201);
    expect(agent.body.recommendations.length).toBeGreaterThan(0);
  });

  it('runs what-if analysis without changing the official record', async () => {
    store.students.set('S-001', { ...record, registerNumber: 'REG001', codingScore: 60, interviewEligible: false, selected: false } as CanonicalStudent);
    const result = await request(app.getHttpServer()).post('/api/ai/students/S-001/what-if')
      .send({ codingScore: 85 }).expect(201);
    expect(result.body.projected.interviewEligible).toBe(true);
    expect(result.body.mutatedOfficialRecord).toBe(false);
    expect(store.students.get('S-001')?.codingScore).toBe(60);
  });
});
