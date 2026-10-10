import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaService } from './common/prisma.service';
import { SharedStateSession, StateScope } from './shared-state';
import { Prisma, PrismaClient } from '@prisma/client';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  AdvisoryAnalysis,
  AgentRecommendation,
  CanonicalStudent,
  CommunicationResult,
  IntegrationLog,
  InterviewResult,
} from './domain';

@Injectable()
export class Store implements OnModuleInit, OnModuleDestroy {
  private createState() { return {
    students: new Map<string, CanonicalStudent>(),
    communicationResults: new Map<string, CommunicationResult>(),
    interviewResults: new Map<string, InterviewResult>(),
    idempotency: new Map<string, unknown>(), logs: [] as IntegrationLog[],
    analyses: new Map<string, AdvisoryAnalysis>(), recommendations: new Map<string, AgentRecommendation>(),
    allocations: new Map<string, string>(),
    auditEvents: [] as Array<{ type: string; actorId: string; entityId: string; details: unknown; at: string }>,
  }; }
  private readonly base = this.createState();
  private readonly requestState = new AsyncLocalStorage<ReturnType<Store['createState']>>();
  private get state() { return this.requestState.getStore() ?? this.base; }
  get students() { return this.state.students; }
  get communicationResults() { return this.state.communicationResults; }
  get interviewResults() { return this.state.interviewResults; }
  get idempotency() { return this.state.idempotency; }
  get logs() { return this.state.logs; }
  get analyses() { return this.state.analyses; }
  get recommendations() { return this.state.recommendations; }
  get allocations() { return this.state.allocations; }
  get auditEvents() { return this.state.auditEvents; }

  get horizontal() { return process.env.HORIZONTAL_STATE === 'true'; }

  async scoped<T>(scopes: StateScope[], write: boolean, operation: () => Promise<T>): Promise<T> {
    if (!this.database) throw new Error('Shared database is unavailable');
    const work = async () => {
      const session = await SharedStateSession.load(this.database!, scopes);
      return this.requestState.run(this.createState(), async () => {
        // Services may mutate a recommendation object in-place. Keep the loaded
        // version immutable so the optimistic comparison sees those changes.
        this.applyState(JSON.parse(JSON.stringify(session.state)) as Record<string, unknown>);
        const result = await operation();
        if (write) await session.commit(this.database!, this.serialize());
        return result;
      });
    };
    return write ? this.database.atomic(work) : work();
  }

  private readonly stateFile = resolve(process.env.STATE_FILE ?? './data/runtime-state.json');
  private prisma?: PrismaClient;
  private pendingPersistence: Promise<unknown> = Promise.resolve();
  private pendingOperations: Promise<void> = Promise.resolve();

  // Legacy snapshot workflows must not interleave inside this single API instance.
  // Development/legacy mode only; horizontal mode uses independent DB records.
  runExclusive<T>(operation:()=>Promise<T>):Promise<T> {
    const result=this.pendingOperations.then(operation,operation);
    this.pendingOperations=result.then(()=>undefined,()=>undefined);
    return result;
  }

  constructor(@Optional() private readonly database?: PrismaService) {
    if (!this.horizontal) this.load();
  }

  async onModuleInit() {
    if (this.horizontal && ((process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() !== 'postgres' || !process.env.DATABASE_URL)) throw new Error('Horizontal mode requires PostgreSQL persistence');
    if ((process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() !== 'postgres') return;
    if (this.horizontal) {
      if (!this.database) throw new Error('Horizontal mode requires PostgreSQL');
      const ready = await this.database.$queryRaw<Array<{ version: number }>>`SELECT "version" FROM "SharedStateRecord" WHERE "namespace" = '_system' AND "key" = 'migration'`;
      if (ready[0]?.version !== 1) throw new Error('Shared state cutover migration is required');
      return;
    }
    this.prisma = new PrismaClient();
    await this.prisma.$connect();
    const saved = await this.prisma.runtimeState.findUnique({ where: { id: 'main' } });
    if (saved?.payload) this.applyState(saved.payload as Record<string, unknown>);
  }

  async onModuleDestroy() {
    await this.flush();
    await this.prisma?.$disconnect();
  }

  async flush() { await this.pendingPersistence; }

  persist() {
    if (this.horizontal) {
      if (!this.requestState.getStore()) throw new Error('Shared state mutation requires a request transaction');
      return; // The request commits entity deltas and official writes together.
    }
    const state = this.serialize();
    if (this.prisma) {
      const payload = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
      this.pendingPersistence = this.pendingPersistence.catch(() => undefined).then(() => this.prisma!.runtimeState.upsert({
        where: { id: 'main' },
        create: { id: 'main', payload },
        update: { payload },
      }));
      // The response interceptor awaits flush and propagates database errors.
      void this.pendingPersistence.catch(() => undefined);
      return;
    }
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2));
    renameSync(temporary, this.stateFile);
  }

  private serialize() {
    return {
      students: [...this.students.entries()],
      communicationResults: [...this.communicationResults.entries()],
      interviewResults: [...this.interviewResults.entries()],
      idempotency: [...this.idempotency.entries()],
      logs: this.logs,
      analyses: [...this.analyses.entries()],
      recommendations: [...this.recommendations.entries()],
      allocations: [...this.allocations.entries()],
      auditEvents: this.auditEvents,
    };
  }

  reset() {
    this.students.clear();
    this.communicationResults.clear();
    this.interviewResults.clear();
    this.idempotency.clear();
    this.logs.splice(0);
    this.analyses.clear();
    this.recommendations.clear();
    this.allocations.clear();
    this.auditEvents.splice(0);
    this.persist();
  }

  private load() {
    if (!existsSync(this.stateFile)) return;
    try {
      this.applyState(JSON.parse(readFileSync(this.stateFile, 'utf8')) as Record<string, unknown>);
    } catch {
      // A damaged development snapshot must not prevent the API from starting.
    }
  }

  private applyState(state: Record<string, unknown>) {
    this.students.clear(); this.communicationResults.clear(); this.interviewResults.clear(); this.idempotency.clear();
    this.logs.splice(0); this.analyses.clear(); this.recommendations.clear(); this.allocations.clear(); this.auditEvents.splice(0);
    this.restoreMap(this.students, state.students);
    this.restoreMap(this.communicationResults, state.communicationResults);
    this.restoreMap(this.interviewResults, state.interviewResults);
    this.restoreMap(this.idempotency, state.idempotency);
    this.logs.push(...((state.logs as IntegrationLog[] | undefined) ?? []));
    this.restoreMap(this.analyses, state.analyses);
    this.restoreMap(this.recommendations, state.recommendations);
    this.restoreMap(this.allocations, state.allocations);
    this.auditEvents.push(...((state.auditEvents as typeof this.auditEvents | undefined) ?? []));
  }

  private restoreMap<K, V>(target: Map<K, V>, value: unknown) {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length === 2) target.set(entry[0] as K, entry[1] as V);
    }
  }
}
