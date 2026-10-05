import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentRecommendation, DOMAIN_CAPACITIES } from './domain';
import { AiService } from './ai.service';
import { Store } from './store';

@Injectable()
export class AgentService {
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  async run() {
    const eligible = [...this.store.students.values()].filter((s) => (s.interviewEligible || s.selected) && !this.store.allocations.has(s.studentId));
    const created: AgentRecommendation[] = [];
    for (const student of eligible) {
      const existing = [...this.store.recommendations.values()].find((item) => item.studentId === student.studentId && item.status === 'PENDING_APPROVAL');
      if (existing) { created.push(existing); continue; }
      const analysis = this.store.analyses.get(student.studentId) ?? await this.ai.analyze(student.studentId);
      const domain = analysis.recommendedDomains[0]?.domain;
      if (!domain) continue;
      const used = [...this.store.allocations.values()].filter((d) => d === domain).length;
      const capacity = DOMAIN_CAPACITIES[domain] ?? 0;
      const conflicts = capacity === 0 ? ['Unknown domain capacity'] : used >= capacity ? ['Domain is at capacity'] : [];
      const recommendation: AgentRecommendation = {
        id: randomUUID(),
        studentId: student.studentId,
        recommendedDomain: domain,
        rationale: [analysis.recommendedDomains[0].reason, `Capacity ${used}/${capacity}`],
        conflicts,
        status: 'PENDING_APPROVAL',
      };
      this.store.recommendations.set(recommendation.id, recommendation);
      created.push(recommendation);
    }
    const runId = randomUUID();
    this.store.auditEvents.push({
      type: 'AGENT_RUN_COMPLETED', actorId: 'selection-agent', entityId: runId,
      details: { eligiblePoolSize: eligible.length, recommendations: created.length }, at: new Date().toISOString(),
    });
    this.store.persist();
    return { runId, eligiblePoolSize: eligible.length, recommendations: created, state: 'AWAITING_AUTHORIZED_APPROVAL' };
  }

  approve(id: string, approverId: string, decision: 'APPROVE' | 'REJECT') {
    const recommendation = this.store.recommendations.get(id);
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    if (recommendation.status !== 'PENDING_APPROVAL') throw new BadRequestException('Recommendation already decided');
    if (decision === 'APPROVE') this.assertCanApply(recommendation);
    recommendation.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    recommendation.approvedBy = approverId;
    recommendation.approvedAt = new Date().toISOString();
    if (decision === 'APPROVE') this.applyAndVerify(recommendation);
    this.store.auditEvents.push({
      type: `AGENT_RECOMMENDATION_${decision}`,
      actorId: approverId,
      entityId: recommendation.id,
      details: { studentId: recommendation.studentId, domain: recommendation.recommendedDomain, finalStatus: recommendation.status },
      at: new Date().toISOString(),
    });
    this.store.persist();
    return recommendation;
  }

  list() {
    return [...this.store.recommendations.values()];
  }

  private applyAndVerify(recommendation: AgentRecommendation) {
    this.store.allocations.set(recommendation.studentId, recommendation.recommendedDomain);
    if (this.store.allocations.get(recommendation.studentId) !== recommendation.recommendedDomain) {
      throw new BadRequestException('Allocation verification failed');
    }
    recommendation.status = 'VERIFIED';
    recommendation.verifiedAt = new Date().toISOString();
  }

  private assertCanApply(recommendation: AgentRecommendation) {
    if (recommendation.conflicts.length) throw new BadRequestException(`Cannot apply: ${recommendation.conflicts.join(', ')}`);
    const capacity = DOMAIN_CAPACITIES[recommendation.recommendedDomain] ?? 0;
    const used = [...this.store.allocations.values()].filter((domain) => domain === recommendation.recommendedDomain).length;
    if (used >= capacity) throw new BadRequestException('Capacity changed before approval; rerun required');
  }
}
