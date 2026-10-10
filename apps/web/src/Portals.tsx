import React, { lazy, useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import './portals.css';
import { Icon, WorkspaceShell } from './WorkspaceShell';
import { StudentDirectory } from './StudentDirectory';
const SelectionRules = lazy(() => import('./SelectionRules').then(m=>({default:m.SelectionRules})));

export type CurrentUser = {
  sub: string;
  email: string;
  loginIdentifier?: string;
  role: 'ADMIN' | 'COORDINATOR' | 'PEP_STAFF' | 'STUDENT';
  studentId?: string | null;
  facultyDomainId?: string | null;
  facultyDomainCode?: string | null;
  facultyDomainName?: string | null;
};

type Profile = {
  student: { studentId: string; name: string; registerNumber: string | null; department: string; batch: string };
  cycle: { code: string; name: string; status: string } | null;
  workflowState?: string;
  outcome: string;
  assessmentStatus?: 'PENDING' | 'AVAILABLE';
  readiness: {
    score: number | null; maxScore: number; verificationStatus: string; assessedAt: string | null; source: string | null;
    parameters: Array<{ key: string; label: string; maxScore: number; rawScore: number | null; verificationStatus: string }>;
  };
  rosterAllocation?: { trainingGroup: string; trainingLevel: string | null; sourceFile: string; sourceSheet: string; importedAt: string } | null;
  reason: string;
  externalScores?: Array<{ type: string; score: number; maxScore: number; source: string; assessedAt: string; originalScore: number | null; originalMaxScore: number | null }>;
  failedReasons?: string[];
  nextSteps: string[];
  timeline: Array<{ label: string; state: string }>;
  eligibility?: { isEligible: boolean } | null;
  ranking?: { rank: number; totalScore: number; percentile: number | null } | null;
  classification?: { program: string; status: string } | null;
  allocation?: { status: string; domain: string | null; batch: string | null; failureReason: string | null } | null;
  preferences: Array<{ rank: number; domain: string }>;
  scoreBreakdown: Array<{ parameter: string; rawScore: number; weightedScore: number; isMissing: boolean }>;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `Request failed (${response.status})`);
  return body as T;
}

export function ProfileView({ studentId }: { studentId?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setProfile(null);
    setError('');
    void json<Profile>(studentId ? `/profiles/${encodeURIComponent(studentId)}` : '/profiles/me')
      .then((result) => { if (live) setProfile(result); })
      .catch((cause) => { if (live) setError(cause.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [studentId]);

  if (loading) return <div className="portalCard">Loading selection profile…</div>;
  if (error) return <div className="portalCard portalError">{error}</div>;
  if (!profile) return null;
  const selected = profile.classification?.program === 'HOPE' || profile.classification?.program === 'PEP';
  const statusLabel = ({
    FINALIZED: `Selected for ${profile.classification?.program ?? 'training'}`,
    SELECTED_PENDING_APPROVAL: `${profile.classification?.program ?? 'Program'} placement — Approval pending`,
    NOT_ELIGIBLE: 'Not eligible for this cycle',
    WAITLISTED: 'Waitlisted',
    ALLOCATION_REJECTED: 'Allocation needs review',
    NOT_IN_CYCLE: profile.rosterAllocation ? 'Training assigned · Assessments pending' : profile.assessmentStatus === 'PENDING' ? 'Assessment data pending' : 'Awaiting cycle enrollment',
    IN_PROGRESS: 'Selection in progress',
  } as Record<string, string>)[profile.outcome] ?? profile.outcome.replaceAll('_', ' ');
  const firstPendingStep = profile.eligibility?.isEligible === false ? -1 : profile.timeline.findIndex(step => step.state !== 'DONE');
  const locked = profile.cycle?.status === 'FROZEN' || profile.allocation?.status === 'FROZEN';
  return <div className="profileStack">
    <section className="portalCard outcomeHero">
      <div className="outcomeBadges"><span className={`pill ${(profile.eligibility?.isEligible === false || profile.outcome === 'ALLOCATION_REJECTED') ? 'failed' : selected ? 'verified' : 'neutral'}`}>{statusLabel}</span><span className="outlineBadge"><Icon name="shield" size={13} />{profile.cycle ? 'Official cycle record' : 'Student roster record'}</span>{locked && <span className="outlineBadge"><Icon name="lock" size={13} />Frozen result</span>}</div>
      <div className="outcomeHeading"><div><p className="portalEyebrow">{profile.cycle ? 'OFFICIAL CYCLE OUTCOME' : 'STUDENT PROFILE'}</p><h2>{profile.student.name} — {statusLabel}</h2><p className="outcomeDomain">{profile.allocation?.domain ?? (selected ? `${profile.classification!.program} pathway · Allocation pending` : profile.outcome === 'NOT_ELIGIBLE' ? 'Review the eligibility requirements and next steps below' : profile.outcome === 'WAITLISTED' ? 'Eligible · Waiting for an available place' : profile.assessmentStatus === 'PENDING' ? 'Profile registered · Waiting for assessments' : 'Your selection journey is in progress')}</p><p>{profile.reason}</p></div><div className="outcomeScore"><small>COMPOSITE SCORE</small><b>{profile.ranking ? Number(profile.ranking.totalScore).toFixed(2) : '—'}</b><span>{profile.ranking ? `Rank #${profile.ranking.rank}` : 'Ranking pending'}</span></div></div>
      <div className="profileIdentity"><span><Icon name="users" size={15} />{profile.student.studentId} · {profile.student.registerNumber ?? 'No register number'}</span><span><Icon name="building" size={15} />{profile.student.department} · {profile.student.batch}</span><span><Icon name="nodes" size={15} />{profile.cycle?.name ?? 'Not enrolled in a cycle'}</span></div>
    </section>
    <section className="portalCard journeyCard" id="selection-process"><div className="panelHead"><div><h3>Candidate Lifecycle & Validation</h3><p className="portalMuted">Your progress through the official selection process</p></div><span className="outlineBadge">{profile.workflowState?.replaceAll('_', ' ') ?? (profile.assessmentStatus === 'PENDING' ? 'Awaiting assessments' : 'Awaiting cycle enrollment')}</span></div>
      <div className="processGrid">{profile.timeline.map((step, index) => <div className={`processStep ${step.state.toLowerCase()} ${index === firstPendingStep ? 'current' : ''}`} key={step.label}><span>{step.state === 'DONE' ? '✓' : index + 1}</span><small>STEP {String(index + 1).padStart(2, '0')}</small><b>{step.label}</b><em>{step.state.replaceAll('_', ' ')}</em></div>)}</div>
    </section>
    <section className="portalCard"><h3>Communication & Interview Scores</h3>{profile.externalScores?.length ? profile.externalScores.map(s => <p key={s.type}><b>{s.type}: {s.score} / {s.maxScore}</b> · {s.source} · {new Date(s.assessedAt).toLocaleString()}{s.originalMaxScore && ` · Original: ${s.originalScore}/${s.originalMaxScore}`}</p>) : <p className="portalMuted">No completed matched assessments imported yet.</p>}<p className="portalMuted">Imported assessments do not automatically change official selection decisions.</p></section>
    <div className="profileColumns">
      <div>
        <section className="portalCard" id="decision-rationale"><div className="panelHead"><h3><Icon name="nodes" />{profile.cycle ? 'Algorithmic Decision Rationale' : 'Future Selection Evaluation'}</h3><span className="outlineBadge">{profile.cycle ? 'Official result' : 'Evaluation pending'}</span></div><p>{profile.reason}</p>
          {profile.failedReasons?.length ? <div className="failedReasons"><b>Requirements to address</b><ul>{profile.failedReasons.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
          <div className="rationaleFacts"><span><small>Eligibility result</small><b>{profile.eligibility ? profile.eligibility.isEligible ? 'Eligible' : 'Not eligible' : 'Pending evaluation'}</b></span><span><small>Program classification</small><b>{profile.classification?.program?.replaceAll('_', ' ') ?? 'Pending'}</b></span><span><small>Official ranking</small><b>{profile.ranking ? `#${profile.ranking.rank}` : 'Pending'}</b></span><span><small>{profile.rosterAllocation ? 'New cycle allocation' : 'Allocation status'}</small><b>{profile.allocation?.status?.replaceAll('_', ' ') ?? 'Pending'}</b></span></div>
          <p className="profileFootnote"><Icon name="shield" size={15} />Advisory recommendations require authorized approval before allocation.</p>
        </section>
        <section className="portalCard readinessCard" id="assessment-breakdown"><div className="panelHead"><div><h3>Readiness & 12 Parameter Scores</h3><p className="portalMuted">Latest Project 2 assessment. Separate from the official selection composite score.</p></div></div>
          <div className="readinessSummary"><div><small>READINESS SCORE</small><strong>{profile.readiness.score === null ? 'Pending' : profile.readiness.score}<span> / {profile.readiness.maxScore}</span></strong></div><span className={`pill ${profile.readiness.verificationStatus === 'VERIFIED' ? 'verified' : 'neutral'}`}>{profile.readiness.verificationStatus.replaceAll('_', ' ')}</span></div>
          <p className="portalMuted">{profile.readiness.assessedAt ? `Assessed ${new Date(profile.readiness.assessedAt).toLocaleString()} · ${profile.readiness.source === 'PROJECT_2_LEGACY_TOTAL' ? 'Total imported; individual parameter scores not supplied yet.' : 'Project 2 result'}` : 'Assessment scores have not been supplied. Pending scores are not zero.'}</p>
          <div className="readinessParameters">{profile.readiness.parameters.map((parameter, index) => <div className="readinessParameter" key={parameter.key}><div><small>PARAMETER {String(index + 1).padStart(2, '0')}</small><b>{parameter.label}</b></div><div className="readinessParameterScore"><strong>{parameter.rawScore === null ? 'Pending' : parameter.rawScore}<small> / {parameter.maxScore}</small></strong><span>{parameter.verificationStatus.replaceAll('_', ' ')}</span></div><progress aria-label={`${parameter.label} score`} value={parameter.rawScore ?? 0} max={parameter.maxScore} /></div>)}</div>
        </section>
        <section className="portalCard" id="selection-score-breakdown"><div className="panelHead"><div><h3>Selection Composite Score Breakdown</h3><p className="portalMuted">Configured selection parameters and their weighted contributions</p></div></div>
          {profile.scoreBreakdown.length ? <div className="scoreVectors">{profile.scoreBreakdown.map(score => <div key={score.parameter}><div><b>{score.parameter.replaceAll('_', ' ')}</b><span>{score.isMissing ? 'Missing' : score.rawScore}<small> · Weighted {Number(score.weightedScore).toFixed(2)}</small></span></div><div className="vectorBar"><i style={{ width: `${score.isMissing ? 0 : Math.min(100, Math.max(0, score.rawScore * (score.parameter.toLowerCase() === 'cgpa' ? 10 : 1)))}%` }} /></div></div>)}</div> : <p className="portalMuted">{profile.assessmentStatus === 'PENDING' ? 'Assessment data is not available yet. No scores have been entered; missing scores are not treated as zero.' : 'Score breakdown will appear after the scoring stage.'}</p>}
        </section>
        <section className="portalCard"><div className="panelHead"><h3><Icon name="building" />Student & Academic Record</h3></div><div className="academicFacts"><span><small>Department</small><b>{profile.student.department}</b></span><span><small>Batch</small><b>{profile.student.batch}</b></span><span><small>Register number</small><b>{profile.student.registerNumber ?? 'Pending'}</b></span></div></section>
      </div>
      <div>
        {profile.rosterAllocation && <section className="portalCard trackCard importedTraining" id={profile.cycle ? "imported-training" : "domain-details"}><div className="trackHeader"><span className="outlineBadge">EXISTING COLLEGE ALLOCATION</span><h3>{profile.rosterAllocation.trainingGroup}</h3><p className="portalMuted">Imported from the college Excel roster; not a new algorithmic selection decision.</p></div><dl className="trackDetails"><div><dt>Training group / domain</dt><dd>{profile.rosterAllocation.trainingGroup}</dd></div><div><dt>Training level</dt><dd>{profile.rosterAllocation.trainingLevel ?? 'Not provided'}</dd></div><div><dt>Source</dt><dd>{profile.rosterAllocation.sourceFile}</dd></div><div><dt>Assessment scores</dt><dd>{profile.assessmentStatus === 'PENDING' ? 'Not available yet' : 'See assessment breakdown'}</dd></div></dl></section>}
        {(profile.cycle || !profile.rosterAllocation) && <section className="portalCard trackCard" id="domain-details"><div className="trackHeader"><span className="outlineBadge">TRAINING DOMAIN</span><h3>{profile.allocation?.domain ?? (profile.outcome === 'NOT_ELIGIBLE' ? 'No allocation for this cycle' : 'Domain allocation pending')}</h3><p className="portalMuted">{selected ? `${profile.classification!.program} pathway` : statusLabel}</p></div><dl className="trackDetails"><div><dt>Training batch</dt><dd>{profile.allocation?.batch ?? 'Not assigned'}</dd></div><div><dt>Placement status</dt><dd>{profile.allocation?.status?.replaceAll('_', ' ') ?? 'Pending'}</dd></div><div><dt>Cycle</dt><dd>{profile.cycle?.name ?? 'Pending'}</dd></div></dl>
          {profile.preferences.length ? <><h4>Declared domain preferences</h4><ol className="preferenceList">{profile.preferences.map(preference => <li key={preference.rank}><span>{preference.rank}</span>{preference.domain}</li>)}</ol></> : <p className="portalMuted">No preferences recorded yet.</p>}
          {profile.allocation?.failureReason && <p className="portalError">{profile.allocation.failureReason}</p>}
        </section>}
        <section className="portalCard" id="next-steps"><div className="panelHead"><h3><Icon name="check" />Your Next Steps</h3><span className="outlineBadge">{profile.nextSteps.length} steps</span></div><ol className="nextStepList">{profile.nextSteps.map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>
        <section className="portalCard transparencyCard"><h3><Icon name="shield" />Selection Transparency</h3><p>This profile reflects your {profile.cycle ? 'current official cycle records' : 'college roster and imported training assignment'}. For a correction or clarification, contact your faculty reviewer or administrator.</p></section>
      </div>
    </div>
  </div>;
}

export function StudentPortal({ user, onSignOut }: { user: CurrentUser; onSignOut: () => void }) {
  return <WorkspaceShell student account={user.loginIdentifier ?? user.email} role="Student" onSignOut={onSignOut}><nav className="studentNav" aria-label="Student profile sections"><a href="#overview" className="active"><Icon name="shield" size={16} />My Application</a><a href="#assessment-breakdown"><Icon name="chart" size={16} />Assessment Breakdown</a><a href="#domain-details"><Icon name="building" size={16} />Domain & Training</a><a href="#next-steps"><Icon name="check" size={16} />Next Steps</a></nav><div id="overview"><ProfileView /></div></WorkspaceShell>;
}

type Recommendation = { id: string; studentId: string; recommendedDomain: string; status: string; rationale: string[]; conflicts: string[] };
type Allocation = { id: string; status: string; student: { studentId: string; name: string }; domain: { code: string; name: string } | null; failureReason: string | null };

export function FacultyPortal({ user, onSignOut }: { user: CurrentUser; onSignOut: () => void }) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [r, a] = await Promise.all([
        json<Recommendation[]>('/agent/selection/recommendations'),
        json<Allocation[]>('/allocations'),
      ]);
      setRecommendations(r); setAllocations(a);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not load your domain queue'); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (selected && window.innerWidth < 1100) document.getElementById('faculty-profile')?.scrollIntoView({ behavior: 'smooth' });
  }, [selected]);

  async function decideRecommendation(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    try {
      await json(`/agent/selection/recommendations/${id}/decision`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approverId: user.sub, decision }),
      });
      setNotice(`Recommendation ${decision.toLowerCase()}d.`);
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Decision failed'); }
    finally { setBusy(false); }
  }

  async function decideAllocation(id: string, decision: 'approve' | 'reject') {
    const reason = window.prompt(`Reason for ${decision} (recorded for audit${decision === 'reject' ? ' and shown to the student' : ''}):`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await json(`/allocations/${id}/${decision}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: user.sub, reason: reason.trim() }),
      });
      setNotice(`Allocation ${decision}d.`);
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Decision failed'); }
    finally { setBusy(false); }
  }

  const pendingRecommendations = recommendations.filter(r => r.status === 'PENDING_APPROVAL');
  const pendingAllocations = allocations.filter(a => a.status === 'PENDING_APPROVAL');
  return <WorkspaceShell account={user.email} role={`Domain faculty · ${user.facultyDomainCode ?? 'Unassigned'}`} onSignOut={onSignOut}
    actions={<button className="ghost" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={16} />Refresh queue</button>}
    items={[{ label: 'Domain Overview', icon: 'shield', href: '#overview', active: true }, { label: 'Student Directory', icon: 'users', href: '#faculty-directory' }, { label: 'Advisory Allocation', icon: 'check', href: '#faculty-recommendations' }, { label: 'Allocation Approvals', icon: 'lock', href: '#faculty-allocations' }, { label: 'Selection Rules', icon: 'shield', href: '#faculty-selection-rules' }]}>
    <header id="overview" className="facultyHero"><div><p className="eyebrow">ST. JOSEPH’S / FACULTY PORTAL</p><h1>Domain Allocation<br />& Student Review</h1></div><div className="authorityCard"><Icon name="shield" size={24} /><div><b>Assigned authority</b><p>{user.facultyDomainCode} · {user.facultyDomainName}</p><small>Domain approval privileges</small></div></div></header>
    <div className="governanceBanner"><Icon name="shield" /><p><b>Domain permissions enforced:</b> You can approve allocations and recommendations for <strong>{user.facultyDomainName ?? 'your assigned domain'}</strong>. All other student profiles are available for read-only review.</p><span className="outlineBadge">SCOPED ACCESS</span></div>
    {notice ? <p className="portalNotice" role="status">{notice}</p> : null}
    <div className="facultyMetrics"><article className="metric assignedMetric"><span>YOUR ASSIGNED DOMAIN</span><h3>{user.facultyDomainName ?? 'No domain assigned'}</h3><p>{user.facultyDomainCode}</p><small>Approval actions available for this domain</small></article><article className="metric"><span>Advisory review</span><b>{pendingRecommendations.length}</b><small>Recommendations awaiting approval</small></article><article className="metric"><span>Allocation approvals</span><b>{pendingAllocations.length}</b><small>Pending placements in your domain</small></article><article className="metric"><span>Student directory</span><b>{directoryTotal}</b><small>All students · Read only</small></article></div>
    <div className="facultyColumns">
      <div className="facultyQueues">
        <StudentDirectory id="faculty-directory" onOpenProfile={setSelected} onTotal={setDirectoryTotal} />
        <section className="portalCard" id="faculty-recommendations"><div className="panelHead"><h3><Icon name="nodes" />Advisory Recommendations</h3><span className="outlineBadge">{recommendations.length} records</span></div>{recommendations.length ? recommendations.map(r => <div className={`queueRow ${selected === r.studentId ? 'selectedQueue' : ''}`} key={r.id}><div><button className="textButton" onClick={() => setSelected(r.studentId)}>{r.studentId}</button><p>{r.recommendedDomain}</p><small>{r.rationale.join(' · ')}</small>{r.conflicts.length ? <p className="portalError">{r.conflicts.join(', ')}</p> : null}</div><div className="queueDecisions"><span className={`pill ${r.status.toLowerCase()}`}>{r.status.replaceAll('_', ' ')}</span>{r.status === 'PENDING_APPROVAL' ? <div className="portalActions"><button disabled={busy || !!r.conflicts.length} onClick={() => void decideRecommendation(r.id, 'APPROVE')}>Approve</button><button className="ghost" disabled={busy} onClick={() => void decideRecommendation(r.id, 'REJECT')}>Reject</button></div> : null}</div></div>) : <div className="emptyState"><Icon name="check" size={28} /><b>No recommendations to review</b><p>Your domain queue will appear after the advisory agent runs.</p></div>}</section>
        <section className="portalCard" id="faculty-allocations"><div className="panelHead"><h3><Icon name="lock" />Allocation Approvals</h3><span className="outlineBadge">{allocations.length} records</span></div>{allocations.length ? allocations.map(a => <div className="queueRow" key={a.id}><div><button className="textButton" onClick={() => setSelected(a.student.studentId)}>{a.student.name}</button><small className="tableMeta">{a.student.studentId}</small><p>{a.domain?.name ?? a.failureReason ?? 'No domain'}</p></div><div className="queueDecisions"><span className={`pill ${a.status.toLowerCase()}`}>{a.status.replaceAll('_', ' ')}</span>{a.status === 'PENDING_APPROVAL' ? <div className="portalActions"><button disabled={busy} onClick={() => void decideAllocation(a.id, 'approve')}>Approve</button><button className="ghost" disabled={busy} onClick={() => void decideAllocation(a.id, 'reject')}>Reject</button></div> : null}</div></div>) : <div className="emptyState"><Icon name="lock" size={28} /><b>No allocations yet</b><p>Placements for your domain will appear here.</p></div>}</section>
      </div>
      <section id="faculty-profile" className="facultyProfile"><div className="profileStudioHeader"><Icon name="shield" /><div><b>Candidate Allocation Studio</b><small>Official profile · Read-only inspection</small></div>{selected && <button className="ghost" onClick={() => setSelected(null)}>Close</button>}</div>{selected ? <ProfileView studentId={selected} /> : <div className="profilePlaceholder"><Icon name="users" size={44} /><h3>Select a candidate</h3><p>Review their progress, score breakdown, selection rationale, and next steps here.</p><span className="outlineBadge">Approval stays in your domain queue</span></div>}</section>
    </div>
    <SelectionRules user={user} />
  </WorkspaceShell>;
}
