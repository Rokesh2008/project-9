import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/common/prisma.service';

describe('Production authentication and RBAC boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let cycleId: string;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_TOKEN_SECRET =
      'project9-test-signing-secret-that-is-long-enough-2026';
    process.env.ADMIN_BOOTSTRAP_KEY = 'bootstrap-test-key';
    process.env.INTEGRATION_API_KEY = 'integration-test-key';
    process.env.PERSISTENCE_DRIVER = 'file';
    process.env.DEMO_MODE = 'false';
    process.env.STATE_FILE = `/tmp/project9-auth-test-${process.pid}.json`;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    prisma = module.get(PrismaService);
    auth = module.get(AuthService);
    await app.init();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.cycleConfig.deleteMany();
    await prisma.selectionCycle.deleteMany();

    const cycle = await prisma.selectionCycle.create({
      data: {
        code: 'AUTH-2026',
        name: 'Auth Test Cycle',
        academicPeriod: '2026',
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    cycleId = cycle.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.cycleConfig.deleteMany();
    await prisma.selectionCycle.deleteMany();
    await app.close();
    delete process.env.AUTH_REQUIRED;
    delete process.env.AUTH_TOKEN_SECRET;
    delete process.env.ADMIN_BOOTSTRAP_KEY;
    delete process.env.INTEGRATION_API_KEY;
    delete process.env.PERSISTENCE_DRIVER;
    delete process.env.DEMO_MODE;
  });

  it('bootstraps an administrator and issues a signed bearer token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/bootstrap')
      .set('x-bootstrap-key', 'bootstrap-test-key')
      .send({
        name: 'Project Admin',
        email: 'admin@test.local',
        password: 'admin-password-123',
      })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@test.local',
        password: 'admin-password-123',
      })
      .expect(201);

    expect(login.body.accessToken.split('.')).toHaveLength(3);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('ADMIN');
  });

  it('requires authentication for protected APIs', async () => {
    await request(app.getHttpServer())
      .get('/api/reports/selection-summary')
      .expect(401);
  });

  it('prevents a student token from spoofing an ADMIN x-role header', async () => {
    await prisma.user.create({
      data: {
        name: 'Student User',
        email: 'student@test.local',
        password: auth.hashPassword('student-password-123'),
        role: 'STUDENT',
      },
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'student@test.local',
        password: 'student-password-123',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/cycles/config')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('x-role', 'ADMIN')
      .set('x-actor-id', 'spoofed-admin')
      .send({ selectionCycleId: cycleId, hopeCount: 1, pepCount: 1 })
      .expect(403);
  });

  it('does not allow a student bearer token to access integration endpoints', async () => {
    await prisma.user.create({
      data: {
        name: 'Integration Student',
        email: 'integration-student@test.local',
        password: auth.hashPassword('integration-student-password-123'),
        role: 'STUDENT',
      },
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'integration-student@test.local',
        password: 'integration-student-password-123',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/integrations/logs')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
  });

  it('requires the integration API key for external system ingestion', async () => {
    const payload = {
      sourceBatchId: 'AUTH-P2',
      records: [
        {
          studentId: 'S-AUTH',
          registerNumber: 'REG-AUTH',
          name: 'Auth Student',
          department: 'CSE',
          cgpa: 8,
          codingScore: 80,
          aptitudeScore: 75,
          attendancePercent: 90,
          dsaLevel: 'INTERMEDIATE',
          preferences: [],
          completedCertificates: [],
          program: 'UNASSIGNED',
          sourceUpdatedAt: '2026-09-30T00:00:00.000Z',
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'auth-int-1')
      .send(payload)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/integrations/project2/students')
      .set('Idempotency-Key', 'auth-int-2')
      .set('x-integration-api-key', 'integration-test-key')
      .send(payload)
      .expect(201);
  });
});
