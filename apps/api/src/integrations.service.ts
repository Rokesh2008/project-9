import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { Project1ResultsDto, Project2ImportDto, Project8ResultsDto } from './dto';
import { CanonicalStudent, IntegrationLog, SourceCode } from './domain';
import { Store } from './store';
import { OfficialIntegrationService } from './official-integration.service';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly store: Store,
    private readonly official: OfficialIntegrationService,
  ) {}

  async importProject2(payload: Project2ImportDto, idempotencyKey: string) {
    const cached = this.checkRequest(idempotencyKey, 'PROJECT_2', payload);
    if (cached) return cached;
    const result = this.once(
      idempotencyKey,
      'PROJECT_2',
      'students.import',
      'API',
      payload.records.length,
      () => this.importProject2Unchecked(payload),
    );

    const official = await this.official.importProject2(payload);

    return this.cacheRequest(idempotencyKey, 'PROJECT_2', payload, { ...result, official });
  }

  async importProject1(payload: Project1ResultsDto, idempotencyKey: string) {
    const cached = this.checkRequest(idempotencyKey, 'PROJECT_1', payload);
    if (cached) return cached;
    const result = this.once(
      idempotencyKey,
      'PROJECT_1',
      'communication-results.import',
      'API',
      payload.records.length,
      () => {
        const unknown = payload.records.find((row) => !this.store.students.has(row.studentId));
        if (!this.official.enabled() && unknown) {
          throw new BadRequestException(`Unknown student ${unknown.studentId}`);
        }
        let inserted = 0;
        for (const row of payload.records) {
          if (!this.store.communicationResults.has(row.resultId)) {
            this.store.communicationResults.set(row.resultId, row);
            inserted++;
          }
        }
        return { inserted, ignoredDuplicates: payload.records.length - inserted, reEvaluationQueued: inserted };
      },
    );

    const official = await this.official.importProject1(payload);

    return this.cacheRequest(idempotencyKey, 'PROJECT_1', payload, { ...result, official });
  }

  async importProject8(payload: Project8ResultsDto, idempotencyKey: string) {
    const cached = this.checkRequest(idempotencyKey, 'PROJECT_8', payload);
    if (cached) return cached;
    const result = this.once(
      idempotencyKey,
      'PROJECT_8',
      'interview-results.import',
      'API',
      payload.records.length,
      () => {
        const unknown = payload.records.find((row) => !this.store.students.has(row.studentId));
        if (!this.official.enabled() && unknown) {
          throw new BadRequestException(`Unknown student ${unknown.studentId}`);
        }
        let inserted = 0;
        for (const row of payload.records) {
          if (!this.store.interviewResults.has(row.attemptId)) {
            this.store.interviewResults.set(row.attemptId, row);
            inserted++;
          }
        }
        return { inserted, ignoredDuplicates: payload.records.length - inserted, reEvaluationQueued: inserted };
      },
    );

    const official = await this.official.importProject8(payload);

    return this.cacheRequest(idempotencyKey, 'PROJECT_8', payload, { ...result, official });
  }

  async importSpreadsheet(buffer: Buffer, filename: string, idempotencyKey: string) {
    const fingerprint = {filename, sha256:createHash('sha256').update(buffer).digest('hex')};
    const cached = this.checkRequest(idempotencyKey, 'EXCEL', fingerprint);
    if (cached) return cached;
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
      selectionCycleId: rows[0]?.selectionCycleId
        ? String(rows[0].selectionCycleId)
        : undefined,
      sourceBatchId: `manual:${filename}`,
      records: rows.map((row) => ({
        studentId: String(row.studentId),
        registerNumber: String(row.registerNumber),
        name: String(row.name),
        department: String(row.department),
        batchIdentifier: row.batchIdentifier ? String(row.batchIdentifier) : undefined,
        academicYear: row.academicYear ? String(row.academicYear) : undefined,
        readinessScore: row.readinessScore === undefined || row.readinessScore === ''
          ? undefined
          : Number(row.readinessScore),
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
    const result = this.once(
      idempotencyKey,
      'EXCEL',
      'students.import',
      method,
      rows.length,
      () => this.importProject2Unchecked(payload),
    );

    const official = await this.official.importProject2(payload);

    return this.cacheRequest(idempotencyKey, 'EXCEL', fingerprint, { ...result, official });
  }

  private requestFingerprint(source: string, payload: unknown) {
    const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])) : value;
    return createHash('sha256').update(JSON.stringify({source,payload:stable(payload)})).digest('hex');
  }

  private checkRequest(key: string, source: string, payload: unknown): any {
    if (!this.store.horizontal) return undefined;
    if (!key || key.length > 200) throw new BadRequestException('Idempotency-Key must contain 1 to 200 characters');
    const saved = this.store.idempotency.get(key) as {fingerprint?:string;response?:unknown} | undefined;
    if (!saved) return undefined;
    // Legacy imported keys have no fingerprint: do not guess whether a new
    // payload is identical. Ask the caller to use a new key.
    if (!saved.fingerprint || saved.fingerprint !== this.requestFingerprint(source,payload)) throw new ConflictException('Idempotency key belongs to another request; use a new key');
    return {...saved.response as object,duplicate:true};
  }

  private cacheRequest<T>(key: string, source: string, payload: unknown, response: T): T {
    if (this.store.horizontal) this.store.idempotency.set(key,{fingerprint:this.requestFingerprint(source,payload),response});
    return response;
  }

  listLogs() {
    return [...this.store.logs].reverse();
  }

  async exportProject1Candidates(selectionCycleId?: string) {
    const official = await this.official.exportProject1Candidates(selectionCycleId);
    if (official) return official;
    return [...this.store.students.values()].filter(
      (s) => s.interviewEligible && !this.hasCommunicationResult(s.studentId),
    );
  }

  async exportProject8Candidates(selectionCycleId?: string) {
    const official = await this.official.exportProject8Candidates(selectionCycleId);
    if (official) return official;
    return [...this.store.students.values()].filter(
      (s) => s.interviewEligible && !this.hasInterviewResult(s.studentId),
    );
  }

  templateCsv() {
    const headers = [
      'selectionCycleId', 'studentId', 'registerNumber', 'name', 'department',
      'batchIdentifier', 'academicYear', 'readinessScore', 'email', 'cgpa',
      'codingScore', 'aptitudeScore', 'attendancePercent', 'dsaLevel',
      'preferences', 'completedCertificates', 'program', 'sourceUpdatedAt',
    ];
    return `${headers.join(',')}\n,S-001,REG001,Example Student,CSE,CSE-2026,2026,174,student@example.edu,8.2,78,74,91,INTERMEDIATE,PEPC-01 AI/ML|PEPC-05 Data Science,Data Science Foundation,UNASSIGNED,2026-09-24T00:00:00.000Z\n`;
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
