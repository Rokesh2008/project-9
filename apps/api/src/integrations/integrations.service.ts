import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { PrismaService } from '../common/prisma.service';
import { Project1ResultsDto, Project2ImportDto, Project8ResultsDto } from '../dto';
import { StudentsService } from '../students/students.service';

type SourceCode = 'PROJECT_2' | 'PROJECT_1' | 'PROJECT_8' | 'EXCEL';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly students: StudentsService,
  ) {}

  async importProject2(payload: Project2ImportDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_2', 'students.import', 'API', payload.records.length, async () => {
      for (const row of payload.records) {
        await this.students.upsertFromImport({
          studentId: row.studentId,
          name: row.name.trim(),
          email: row.email ?? `${row.studentId}@placeholder.local`,
          department: row.department,
          cgpa: row.cgpa,
          codingScore: row.codingScore,
          aptitudeScore: row.aptitudeScore,
          attendancePercent: row.attendancePercent,
          dsaLevel: row.dsaLevel,
          preferences: row.preferences?.map((x) => x.trim()).filter(Boolean),
          completedCertificates: row.completedCertificates?.map((x) => x.trim()).filter(Boolean),
          program: row.program ?? 'UNASSIGNED',
        });
      }
      return { imported: payload.records.length, sourceBatchId: payload.sourceBatchId };
    });
  }

  async importProject1(payload: Project1ResultsDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_1', 'communication-results.import', 'API', payload.records.length, async () => {
      for (const row of payload.records) {
        const student = await this.prisma.student.findUnique({ where: { studentId: row.studentId } });
        if (!student) throw new BadRequestException(`Unknown student ${row.studentId}`);
      }

      let inserted = 0;
      for (const row of payload.records) {
        const student = await this.prisma.student.findUnique({ where: { studentId: row.studentId } });
        if (!student) continue;

        const existing = await this.prisma.assessmentResult.findFirst({
          where: { studentId: student.id, sourceIdentifier: row.resultId },
        });
        if (existing) continue;

        await this.prisma.assessmentResult.create({
          data: {
            studentId: student.id,
            sourceIdentifier: row.resultId,
            assessmentType: 'COMMUNICATION',
            score: row.score,
            maxScore: 100,
            percentage: row.score,
            assessmentDate: new Date(row.assessedAt),
            metadata: { level: row.level },
          },
        });
        inserted++;
      }
      return { inserted, ignoredDuplicates: payload.records.length - inserted, reEvaluationQueued: inserted };
    });
  }

  async importProject8(payload: Project8ResultsDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_8', 'interview-results.import', 'API', payload.records.length, async () => {
      for (const row of payload.records) {
        const student = await this.prisma.student.findUnique({ where: { studentId: row.studentId } });
        if (!student) throw new BadRequestException(`Unknown student ${row.studentId}`);
      }

      let inserted = 0;
      for (const row of payload.records) {
        const student = await this.prisma.student.findUnique({ where: { studentId: row.studentId } });
        if (!student) continue;

        const existing = await this.prisma.assessmentResult.findFirst({
          where: { studentId: student.id, sourceIdentifier: row.attemptId },
        });
        if (existing) continue;

        const attemptCount = await this.prisma.assessmentResult.count({
          where: { studentId: student.id, assessmentType: 'INTERVIEW' },
        });

        await this.prisma.assessmentResult.create({
          data: {
            studentId: student.id,
            sourceIdentifier: row.attemptId,
            assessmentType: 'INTERVIEW',
            score: row.score,
            maxScore: 100,
            percentage: row.score,
            attemptNumber: attemptCount + 1,
            assessmentDate: new Date(row.interviewedAt),
            metadata: { outcome: row.outcome, notes: row.notes },
          },
        });
        inserted++;
      }
      return { inserted, ignoredDuplicates: payload.records.length - inserted, reEvaluationQueued: inserted };
    });
  }

  async importSpreadsheet(buffer: Buffer, filename: string, idempotencyKey: string) {
    const workbook = new ExcelJS.Workbook();
    if (filename.toLowerCase().endsWith('.csv')) {
      await workbook.csv.read(Readable.from(buffer));
    } else {
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('Spreadsheet must include a header row and at least one record');
    }
    const headers = worksheet.getRow(1).values as unknown[];
    const rows: Record<string, unknown>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      for (let column = 1; column < headers.length; column++) {
        const header = String(headers[column] ?? '').trim();
        if (header) record[header] = this.cellValue(row.getCell(column).value);
      }
      if (Object.values(record).some((value) => String(value).trim() !== '')) rows.push(record);
    });
    const payload = plainToInstance(Project2ImportDto, {
      sourceBatchId: `manual:${filename}`,
      records: rows.map((row) => ({
        studentId: String(row.studentId),
        registerNumber: String(row.registerNumber),
        name: String(row.name),
        department: String(row.department),
        email: row.email ? String(row.email) : undefined,
        cgpa: Number(row.cgpa),
        codingScore: Number(row.codingScore),
        aptitudeScore: Number(row.aptitudeScore),
        attendancePercent: Number(row.attendancePercent),
        dsaLevel: String(row.dsaLevel).toUpperCase(),
        preferences: this.list(row.preferences),
        completedCertificates: this.list(row.completedCertificates),
        program: row.program ? String(row.program).toUpperCase() : 'UNASSIGNED',
        sourceUpdatedAt: String(row.sourceUpdatedAt),
      })),
    });
    const errors = validateSync(payload, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      const details = errors.flatMap((error) => error.children ?? []).map((error) => ({
        property: error.property,
        constraints: error.constraints,
        children: error.children,
      }));
      throw new BadRequestException({ message: 'Spreadsheet validation failed', details });
    }
    const method = filename.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX';
    return this.once(idempotencyKey, 'EXCEL', 'students.import', method, rows.length, () =>
      this.importProject2Unchecked(payload),
    );
  }

  async listLogs() {
    const jobs = await this.prisma.integrationJob.findMany({
      include: { source: true },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    return jobs.map((job) => ({
      id: job.id,
      source: job.source.code,
      operation: job.operation,
      method: job.method,
      status: job.status,
      recordCount: job.recordCount,
      requestId: job.idempotencyKey,
      startedAt: job.startedAt.toISOString(),
      endedAt: job.endedAt?.toISOString() ?? job.startedAt.toISOString(),
      error: job.error ? String(job.error) : undefined,
    }));
  }

  async exportProject1Candidates() {
    const students = await this.prisma.student.findMany({
      where: { isActive: true },
      include: {
        batch: { include: { department: true } },
        assessmentResults: true,
        eligibilityResults: { where: { isEligible: true }, take: 1 },
      },
    });

    return students
      .filter((s) => s.eligibilityResults.length > 0)
      .filter((s) => !s.assessmentResults.some((a) => a.assessmentType === 'COMMUNICATION'))
      .map((s) => ({
        studentId: s.studentId,
        name: s.name,
        email: s.email,
        department: s.batch?.department?.code ?? '',
      }));
  }

  async exportProject8Candidates() {
    const students = await this.prisma.student.findMany({
      where: { isActive: true },
      include: {
        batch: { include: { department: true } },
        assessmentResults: true,
        eligibilityResults: { where: { isEligible: true }, take: 1 },
      },
    });

    return students
      .filter((s) => s.eligibilityResults.length > 0)
      .filter((s) => !s.assessmentResults.some((a) => a.assessmentType === 'INTERVIEW'))
      .map((s) => ({
        studentId: s.studentId,
        name: s.name,
        email: s.email,
        department: s.batch?.department?.code ?? '',
      }));
  }

  templateCsv() {
    const headers = [
      'studentId', 'registerNumber', 'name', 'department', 'email', 'cgpa', 'codingScore',
      'aptitudeScore', 'attendancePercent', 'dsaLevel', 'preferences', 'completedCertificates',
      'program', 'sourceUpdatedAt',
    ];
    return `${headers.join(',')}\nS-001,REG001,Example Student,CSE,student@example.edu,8.2,78,74,91,INTERMEDIATE,PEPC-01 AI/ML|PEPC-05 Data Science,Data Science Foundation,UNASSIGNED,2026-09-24T00:00:00.000Z\n`;
  }

  private async importProject2Unchecked(payload: Project2ImportDto) {
    for (const row of payload.records) {
      await this.students.upsertFromImport({
        studentId: row.studentId,
        name: row.name.trim(),
        email: row.email ?? `${row.studentId}@placeholder.local`,
        department: row.department,
        cgpa: row.cgpa,
        codingScore: row.codingScore,
        aptitudeScore: row.aptitudeScore,
        attendancePercent: row.attendancePercent,
        dsaLevel: row.dsaLevel,
        preferences: row.preferences,
        completedCertificates: row.completedCertificates,
        program: row.program ?? 'UNASSIGNED',
      });
    }
    return { imported: payload.records.length, sourceBatchId: payload.sourceBatchId };
  }

  private list(value: unknown) {
    return String(value ?? '').split('|').map((x) => x.trim()).filter(Boolean);
  }

  private cellValue(value: ExcelJS.CellValue): string | number | boolean {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      if ('result' in value && value.result !== undefined) return this.cellValue(value.result);
      if ('text' in value) return String(value.text);
      if ('richText' in value) return value.richText.map((part) => part.text).join('');
      return String(value);
    }
    return value;
  }

  private async getOrCreateSource(code: SourceCode): Promise<number> {
    const names: Record<SourceCode, string> = {
      PROJECT_2: 'Project 2 - Student Data',
      PROJECT_1: 'Project 1 - Communication',
      PROJECT_8: 'Project 8 - Interview',
      EXCEL: 'Spreadsheet Import',
    };
    const source = await this.prisma.integrationSource.upsert({
      where: { code },
      create: { code, name: names[code] },
      update: { lastSeenAt: new Date() },
    });
    return source.id;
  }

  private async once<T>(
    key: string,
    source: SourceCode,
    operation: string,
    method: string,
    count: number,
    work: () => T | Promise<T>,
  ): Promise<T & { duplicate?: boolean }> {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');

    const existing = await this.prisma.integrationJob.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing) {
      return { duplicate: true } as T & { duplicate: boolean };
    }

    const sourceId = await this.getOrCreateSource(source);

    const job = await this.prisma.integrationJob.create({
      data: {
        sourceId,
        operation,
        method,
        idempotencyKey: key,
        status: 'PROCESSING',
        recordCount: count,
      },
    });

    try {
      const result = await work();

      await this.prisma.integrationJob.update({
        where: { id: job.id },
        data: { status: 'SUCCEEDED', endedAt: new Date() },
      });

      await this.prisma.integrationLog.create({
        data: {
          jobId: job.id,
          level: 'INFO',
          message: `${operation} completed successfully`,
          details: result as any,
        },
      });

      return result as T & { duplicate?: boolean };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          error: { message: errorMsg },
        },
      });

      await this.prisma.integrationLog.create({
        data: {
          jobId: job.id,
          level: 'ERROR',
          message: `${operation} failed: ${errorMsg}`,
        },
      });

      throw error;
    }
  }
}
