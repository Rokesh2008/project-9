import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  readonly students = new Map<string, CanonicalStudent>();
  readonly communicationResults = new Map<string, CommunicationResult>();
  readonly interviewResults = new Map<string, InterviewResult>();
  readonly idempotency = new Map<string, unknown>();
  readonly logs: IntegrationLog[] = [];
  readonly analyses = new Map<string, AdvisoryAnalysis>();
  readonly recommendations = new Map<string, AgentRecommendation>();
  readonly allocations = new Map<string, string>();
  readonly auditEvents: Array<{ type: string; actorId: string; entityId: string; details: unknown; at: string }> = [];

  private readonly stateFile = resolve(process.env.STATE_FILE ?? './data/runtime-state.json');
  private prisma?: PrismaClient;

  constructor() {
    this.load();
  }

  async onModuleInit() {
    if ((process.env.PERSISTENCE_DRIVER ?? 'file').toLowerCase() !== 'postgres') return;
    this.prisma = new PrismaClient();
    await this.prisma.$connect();
    const saved = await this.prisma.runtimeState.findUnique({ where: { id: 'main' } });
    if (saved?.payload) this.applyState(saved.payload as Record<string, unknown>);
  }

  async onModuleDestroy() { await this.prisma?.$disconnect(); }

  persist() {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    const state = this.serialize();
    writeFileSync(temporary, JSON.stringify(state, null, 2));
    renameSync(temporary, this.stateFile);
    if (this.prisma) {
      void this.prisma.runtimeState.upsert({
        where: { id: 'main' },
        create: { id: 'main', payload: state as unknown as Prisma.InputJsonValue },
        update: { payload: state as unknown as Prisma.InputJsonValue },
      }).catch(() => undefined);
    }
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
