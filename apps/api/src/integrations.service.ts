import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { Project1ResultsDto, Project2ImportDto, Project8ResultsDto } from './dto';
import { CanonicalStudent, IntegrationLog, SourceCode } from './domain';
import { Store } from './store';

@Injectable()
export class IntegrationsService {
  constructor(private readonly store: Store) {}

  importProject2(payload: Project2ImportDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_2', 'students.import', 'API', payload.records.length, () => {
      for (const row of payload.records) {
        const current = this.store.students.get(row.studentId);
        const student: CanonicalStudent = {
          ...row,
          name: row.name.trim(),
          registerNumber: row.registerNumber.trim().toUpperCase(),
          preferences: row.preferences.map((x) => x.trim()).filter(Boolean),
          completedCertificates: row.completedCertificates.map((x) => x.trim()).filter(Boolean),
          program: row.program ?? current?.program ?? 'UNASSIGNED',
          interviewEligible: current?.interviewEligible ?? false,
          selected: current?.selected ?? false,
        };
        this.store.students.set(row.studentId, student);
      }
      return { imported: payload.records.length, sourceBatchId: payload.sourceBatchId };
    });
  }

  importProject1(payload: Project1ResultsDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_1', 'communication-results.import', 'API', payload.records.length, () => {
      const unknown = payload.records.find((row) => !this.store.students.has(row.studentId));
      if (unknown) throw new BadRequestException(`Unknown student ${unknown.studentId}`);
      let inserted = 0;
      for (const row of payload.records) {
        if (!this.store.communicationResults.has(row.resultId)) {
          this.store.communicationResults.set(row.resultId, row);
          inserted++;
        }
      }
      return { inserted, ignoredDuplicates: payload.records.length - inserted, reEvaluationQueued: inserted };
    });
  }

  importProject8(payload: Project8ResultsDto, idempotencyKey: string) {
    return this.once(idempotencyKey, 'PROJECT_8', 'interview-results.import', 'API', payload.records.length, () => {
      const unknown = payload.records.find((row) => !this.store.students.has(row.studentId));
      if (unknown) throw new BadRequestException(`Unknown student ${unknown.studentId}`);
      let inserted = 0;
      for (const row of payload.records) {
        if (!this.store.interviewResults.has(row.attemptId)) {
          this.store.interviewResults.set(row.attemptId, row);
          inserted++;
        }
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

  listLogs() {
    return [...this.store.logs].reverse();
  }

  exportProject1Candidates() {
    return [...this.store.students.values()].filter((s) => s.interviewEligible && !this.hasCommunicationResult(s.studentId));
  }

  exportProject8Candidates() {
    return [...this.store.students.values()].filter((s) => s.interviewEligible && !this.hasInterviewResult(s.studentId));
  }

  templateCsv() {
    const headers = [
      'studentId', 'registerNumber', 'name', 'department', 'email', 'cgpa', 'codingScore',
      'aptitudeScore', 'attendancePercent', 'dsaLevel', 'preferences', 'completedCertificates',
      'program', 'sourceUpdatedAt',
    ];
    return `${headers.join(',')}\nS-001,REG001,Example Student,CSE,student@example.edu,8.2,78,74,91,INTERMEDIATE,PEPC-01 AI/ML|PEPC-05 Data Science,Data Science Foundation,UNASSIGNED,2026-09-24T00:00:00.000Z\n`;
  }

  private importProject2Unchecked(payload: Project2ImportDto) {
    for (const row of payload.records) {
      const current = this.store.students.get(row.studentId);
      this.store.students.set(row.studentId, {
        ...row,
        name: row.name.trim(),
        registerNumber: row.registerNumber.trim().toUpperCase(),
        program: row.program ?? current?.program ?? 'UNASSIGNED',
        interviewEligible: current?.interviewEligible ?? false,
        selected: current?.selected ?? false,
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

  private hasCommunicationResult(studentId: string) {
    return [...this.store.communicationResults.values()].some((r) => r.studentId === studentId);
  }

  private hasInterviewResult(studentId: string) {
    return [...this.store.interviewResults.values()].some((r) => r.studentId === studentId);
  }

  private once<T>(
    key: string,
    source: SourceCode,
    operation: string,
    method: 'API' | 'CSV' | 'XLSX',
    count: number,
    work: () => T,
  ): T & { duplicate?: boolean } {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    const cached = this.store.idempotency.get(key) as T | undefined;
    if (cached) {
      this.log(source, operation, method, 'DUPLICATE', count, key);
      this.store.persist();
      return { ...cached, duplicate: true };
    }
    const started = new Date();
    try {
      const result = work();
      this.store.idempotency.set(key, result);
      this.log(source, operation, method, 'SUCCEEDED', count, key, started);
      this.store.persist();
      return result as T & { duplicate?: boolean };
    } catch (error) {
      this.log(source, operation, method, 'FAILED', count, key, started, error instanceof Error ? error.message : String(error));
      this.store.persist();
      throw error;
    }
  }

  private log(
    source: SourceCode,
    operation: string,
    method: 'API' | 'CSV' | 'XLSX',
    status: IntegrationLog['status'],
    recordCount: number,
    requestId: string,
    started = new Date(),
    error?: string,
  ) {
    this.store.logs.push({
      id: randomUUID(), source, operation, method, status, recordCount, requestId,
      startedAt: started.toISOString(), endedAt: new Date().toISOString(), error,
    });
  }
}
