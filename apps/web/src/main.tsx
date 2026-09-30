import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AllocationAdmin } from './AllocationAdmin';
import { API, TOKEN_KEY, apiFetch, clearSession } from './api';
import './styles.css';
import './extras.css';

type Summary = {
  totalStudents: number;
  interviewEligible: number;
  selected: number;
  allocated: number;
  integrationFailures: number;
  selectionCycleId?: string;
};
type Log = { id: string; source: string; operation: string; method: string; status: string; recordCount: number; endedAt: string };
type Capacity = { domain: string; capacity: number; demand: number; allocated: number; available: number };
type Recommendation = { id: string; studentId: string; recommendedDomain: string; rationale: string[]; conflicts: string[]; status: string };
type Analysis = { strengths: string[]; gaps: string[]; trend: string; recommendedDomains: Array<{ domain: string; score: number; reason: string }> };
type Student = { studentId: string; registerNumber: string; name: string; program: string; codingScore: number; attendancePercent: number; interviewEligible: boolean; selected: boolean; allocation?: string; advisoryAnalysis?: Analysis };
type Anomaly = { studentId: string; severity: string; type: string; detail: string };

function App() {
  const [view, setView] = useState<'member3' | 'allocations'>('member3');
  const [summary, setSummary] = useState<Summary>({ totalStudents: 0, interviewEligible: 0, selected: 0, allocated: 0, integrationFailures: 0 });
  const [logs, setLogs] = useState<Log[]>([]);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [whatIf, setWhatIf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready for synchronized intake');
  const [loginRequired, setLoginRequired] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  async function requestJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await apiFetch(url, init);
    if (response.status === 401) {
      setLoginRequired(true);
      throw new Error('AUTH_REQUIRED');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message ?? `Request failed (${response.status})`);
    }
    return body as T;
  }

  async function refresh() {
    try {
      const [s, l, c, r, st, a] = await Promise.all([
        requestJson<Summary>(`${API}/reports/selection-summary`),
        requestJson<Log[]>(`${API}/integrations/logs`),
        requestJson<Capacity[]>(`${API}/reports/domain-capacity`),
        requestJson<Recommendation[]>(`${API}/agent/selection/recommendations`),
        requestJson<Student[]>(`${API}/students`),
        requestJson<Anomaly[]>(`${API}/ai/anomalies`),
      ]);
      setSummary(s); setLogs(l); setCapacities(c); setRecommendations(r); setStudents(st); setAnomalies(a);
      setLoginRequired(false);
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') return;
      setNotice(error instanceof Error ? error.message : 'API unavailable');
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function importFile(file: File) {
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const result = await requestJson<any>(`${API}/integrations/import/excel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: data,
      });
      setNotice(`Imported ${result.imported} records through the canonical pipeline`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Import failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function runAgent() {
    setBusy(true);
    try {
      const result = await requestJson<any>(`${API}/agent/selection/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectionCycleId: summary.selectionCycleId }),
      });
      setNotice(`Agent analyzed ${result.eligiblePoolSize ?? 0} eligible students; approval remains required`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Agent run failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function runOfficialSelection() {
    if (!summary.selectionCycleId) {
      setNotice('No active selection cycle is available yet');
      return;
    }
    setBusy(true);
    try {
      const result = await requestJson<any>(`${API}/selection-pipeline/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectionCycleId: summary.selectionCycleId }),
      });
      setNotice(`Official selection complete: ${result.selected ?? 0} selected, ${result.waitlisted ?? 0} waitlisted, ${result.ineligible ?? 0} ineligible`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Selection pipeline failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function prepareDemo() {
    setBusy(true);
    try {
      const result = await requestJson<any>(`${API}/demo/run-dependency-simulation`, { method: 'POST' });
      setNotice(`Standalone dependencies ready: ${result.eligibility.eligible} eligible, ${result.project8.selected} selected`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Dependency simulation failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function analyze(studentId: string) {
    setBusy(true);
    try {
      const result = await requestJson<any>(`${API}/ai/students/${studentId}/analyze`, { method: 'POST' });
      setNotice(`${studentId}: ${result.trend} profile; ${result.recommendedDomains.length} domain recommendations`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Analysis failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function simulateImprovement(student: Student) {
    try {
      const result = await requestJson<any>(`${API}/ai/students/${student.studentId}/what-if`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codingScore: Math.min(100, student.codingScore + 10), attendancePercent: Math.max(80, student.attendancePercent) }),
      });
      setWhatIf((current) => ({ ...current, [student.studentId]: result.projected?.interviewEligible
        ? `Projected eligible · fit ${result.projected.recommendationScore}`
        : result.projected?.reasons?.join(', ') ?? result.message }));
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'What-if analysis failed');
      }
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    try {
      const result = await requestJson<any>(`${API}/agent/selection/recommendations/${id}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approverId: 'web-user', decision }),
      });
      setNotice(`Recommendation ${result.status.toLowerCase()}`);
      await refresh();
    } catch (error) {
      if (!(error instanceof Error && error.message === 'AUTH_REQUIRED')) {
        setNotice(error instanceof Error ? error.message : 'Decision failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await apiFetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Login failed');
      localStorage.setItem(TOKEN_KEY, body.accessToken);
      setLoginPassword('');
      setLoginRequired(false);
      setNotice(`Signed in as ${body.user?.name ?? body.user?.email ?? 'user'}`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearSession();
    setLoginRequired(true);
    setNotice('Signed out');
  }

  async function downloadReport(path: string, filename: string) {
    try {
      const response = await apiFetch(`${API}${path}`);
      if (response.status === 401) {
        setLoginRequired(true);
        return;
      }
      if (!response.ok) throw new Error('Report download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Report download failed');
    }
  }

  const topCapacity = useMemo(() => capacities.slice().sort((a, b) => b.demand - a.demand).slice(0, 6), [capacities]);
  const maxCapacity = Math.max(1, ...topCapacity.map((item) => item.capacity));

  if (loginRequired) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', padding: 24 }}>
      <form onSubmit={(event) => void login(event)} style={{ width: 'min(420px, 100%)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 28, boxShadow: '0 20px 50px rgba(15,23,42,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: '#0f172a', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>P9</span>
          <div><h1 style={{ margin: 0, fontSize: 22 }}>Project 9</h1><small style={{ color: '#64748b' }}>Authorized access</small></div>
        </div>
        {notice && <p style={{ background: '#f1f5f9', padding: 10, borderRadius: 8, fontSize: 13 }}>{notice}</p>}
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Email</label>
        <input type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 14 }} />
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Password</label>
        <input type="password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: 18 }} />
        <button disabled={busy} type="submit"
          style={{ width: '100%', padding: '11px 14px', border: 0, borderRadius: 8, background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>;
  }

  if (view === 'allocations') return <div style={{ minHeight: '100vh', background: '#fff' }}>
    <div style={{ display: 'flex', gap: 12, padding: '12px 24px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
      <button onClick={() => setView('member3')} style={{ padding: '6px 16px', background: 'transparent', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>← Back to Command Center</button>
      <span style={{ fontWeight: 700, lineHeight: '32px' }}>Member 2 – Allocation Workflow</span>
    </div>
    <AllocationAdmin />
  </div>;

  return <div className="shell">
    <aside>
      <div className="brand"><span>P9</span><div><strong>Selection OS</strong><small>Member 3 · Command Center</small></div></div>
      <nav>
        <a className="active" href="#overview">Overview</a>
        <a href="#integrations">Integrations</a>
        <a href="#students">Student intelligence</a>
        <a href="#intelligence">AI intelligence</a>
        <a href="#capacity">Capacity analytics</a>
        <a href="#" onClick={(e) => { e.preventDefault(); setView('allocations'); }}>Allocation workflow</a>
      </nav>
      <div className="guardrail"><b>Advisory boundary</b><p>AI can recommend and explain. Only an authorized approval can change allocation.</p></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">PEP / HOPE OPERATIONS</p><h1>Integration command center</h1></div><div className="headerActions"><button className="primary" disabled={busy || !summary.selectionCycleId} onClick={() => void runOfficialSelection()}>Run official selection</button><button className="ghost" disabled={busy} onClick={() => void refresh()}>Refresh data</button><button className="ghost" onClick={logout}>Sign out</button><div className="status"><i />All services monitored</div></div></header>
      <section className="notice"><span>{notice}</span><button onClick={() => void refresh()}>Refresh</button></section>
      <section id="overview" className="metrics">
        <Metric label="Students synchronized" value={summary.totalStudents} tone="cyan" />
        <Metric label="Interview eligible" value={summary.interviewEligible} tone="violet" />
        <Metric label="Verified allocations" value={summary.allocated} tone="green" />
        <Metric label="Integration failures" value={summary.integrationFailures} tone={summary.integrationFailures ? 'orange' : 'neutral'} />
      </section>
      <div className="grid">
        <section id="integrations" className="panel span2">
          <div className="panelHead"><div><p className="eyebrow">LIVE PIPELINES</p><h2>External system exchange</h2></div>
            <label className="upload">{busy ? 'Working…' : 'Import CSV / XLSX'}<input disabled={busy} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} /></label>
          </div>
          <div className="sources">
            <Source code="P2" title="Readiness data" copy="Student and assessment ingestion" />
            <Source code="P1" title="Communication" copy="Eligible export and result return" />
            <Source code="P8" title="Interview" copy="Attempt history without overwrite" />
            <Source code="XL" title="Manual fallback" copy="Same DTO and validation path" />
          </div>
          <table><thead><tr><th>Source</th><th>Operation</th><th>Method</th><th>Records</th><th>Status</th></tr></thead>
            <tbody>{logs.slice(0, 5).map((log) => <tr key={log.id}><td>{log.source}</td><td>{log.operation}</td><td>{log.method}</td><td>{log.recordCount}</td><td><span className={`pill ${log.status.toLowerCase()}`}>{log.status}</span></td></tr>)}
              {!logs.length && <tr><td colSpan={5} className="empty">No transfer jobs yet. Import the provided CSV template to start.</td></tr>}
            </tbody></table>
        </section>
        <section id="capacity" className="panel">
          <div className="panelHead"><div><p className="eyebrow">CAPACITY SIGNAL</p><h2>Domain load</h2></div><b>{capacities.reduce((sum, x) => sum + x.capacity, 0)} seats</b></div>
          <div className="bars">{topCapacity.map((item) => <div className="barRow" key={item.domain}><div><span>{item.domain.replace(/^PEPC-\d+ /, '')}</span><b>{item.demand}/{item.capacity}</b></div><div className="bar"><i style={{ width: `${Math.max(3, item.capacity / maxCapacity * 100)}%` }}><em style={{ width: `${Math.min(100, item.demand / Math.max(1, item.capacity) * 100)}%` }} /></i></div></div>)}</div>
          <div className="exports"><button onClick={() => void downloadReport('/reports/selection.csv', 'selection-report.csv')}>Selection CSV</button><button onClick={() => void downloadReport('/reports/domain-capacity.csv', 'domain-capacity-report.csv')}>Capacity CSV</button></div>
        </section>
        <section id="students" className="panel span3">
          <div className="panelHead"><div><p className="eyebrow">STUDENT INTELLIGENCE</p><h2>Advisory analysis and what-if testing</h2></div><b>{students.length} profiles</b></div>
          <div className="studentTable"><table><thead><tr><th>Student</th><th>Program</th><th>Coding</th><th>Attendance</th><th>Eligibility</th><th>Selection</th><th>Recommendation</th><th>Actions</th></tr></thead><tbody>
            {students.map((student) => <tr key={student.studentId}><td><b>{student.name}</b><small>{student.studentId} · {student.registerNumber}</small></td><td>{student.program}</td><td>{student.codingScore}</td><td>{student.attendancePercent}%</td><td><span className={`pill ${student.interviewEligible ? 'verified' : 'neutral'}`}>{student.interviewEligible ? 'ELIGIBLE' : 'NOT READY'}</span></td><td><span className={`pill ${student.selected ? 'succeeded' : 'neutral'}`}>{student.selected ? 'SELECTED' : 'PENDING'}</span></td><td>{student.allocation ?? student.advisoryAnalysis?.recommendedDomains?.[0]?.domain ?? 'Not analyzed'}{student.advisoryAnalysis && <small>{student.advisoryAnalysis.trend} · Advisory</small>}{whatIf[student.studentId] && <small className="whatIf">{whatIf[student.studentId]}</small>}</td><td><div className="rowActions"><button disabled={busy} onClick={() => void analyze(student.studentId)}>Analyze</button><button className="ghost" onClick={() => void simulateImprovement(student)}>What-if +10</button></div></td></tr>)}
            {!students.length && <tr><td colSpan={8} className="empty">Import a CSV or prepare the standalone demo.</td></tr>}
          </tbody></table></div>
          <div className="analysisGrid">{students.filter((student) => student.advisoryAnalysis).slice(0, 4).map((student) => <article key={student.studentId}><div><small>{student.studentId}</small><h3>{student.name}</h3></div><div><b>Strengths</b><p>{student.advisoryAnalysis!.strengths.join(' · ') || 'No strong signal yet'}</p></div><div><b>Gaps</b><p>{student.advisoryAnalysis!.gaps.join(' · ') || 'No material gaps detected'}</p></div></article>)}</div>
        </section>
        <section className="panel span3 anomalyPanel">
          <div className="panelHead"><div><p className="eyebrow">DATA QUALITY</p><h2>Anomaly review</h2></div><b>{anomalies.length} findings</b></div>
          {anomalies.length ? <div className="anomalyList">{anomalies.slice(0, 8).map((item, index) => <span key={`${item.studentId}-${item.type}-${index}`}><b>{item.severity}</b>{item.studentId} · {item.type.replaceAll('_', ' ')} · {item.detail}</span>)}</div> : <p className="quiet">No duplicate identifiers, missing prerequisites, or unknown domains detected.</p>}
        </section>
        <section id="intelligence" className="panel span3">
          <div className="panelHead"><div><p className="eyebrow">HUMAN-IN-THE-LOOP</p><h2>Selection intelligence queue</h2></div><button className="primary" disabled={busy} onClick={() => void runAgent()}>Run advisory agent</button></div>
          <div className="flow"><span>Read pool</span><i>→</i><span>Analyze</span><i>→</i><span>Detect conflicts</span><i>→</i><span>Recommend</span><i>→</i><span className="approval">Approval</span><i>→</i><span>Verify</span></div>
          <div className="recommendations">{recommendations.slice(-4).map((rec) => <article key={rec.id}><div><small>{rec.studentId}</small><h3>{rec.recommendedDomain}</h3><p>{rec.rationale.join(' · ')}</p>{rec.conflicts.length > 0 && <p className="conflict">{rec.conflicts.join(', ')}</p>}</div><div className="actions"><span className={`pill ${rec.status.toLowerCase()}`}>{rec.status}</span>{rec.status === 'PENDING_APPROVAL' && <><button disabled={busy || rec.conflicts.length > 0} onClick={() => void decide(rec.id, 'APPROVE')}>Approve</button><button className="ghost" disabled={busy} onClick={() => void decide(rec.id, 'REJECT')}>Reject</button></>}</div></article>)}
            {!recommendations.length && <div className="emptyCard"><b>No pending recommendations</b><p>Run the agent after the deterministic eligibility engine has produced an eligible pool.</p></div>}
          </div>
        </section>
      </div>
    </main>
  </div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><b>{value.toLocaleString()}</b><small>Current selection cycle</small></article>;
}
function Source({ code, title, copy }: { code: string; title: string; copy: string }) {
  return <article className="source"><span>{code}</span><div><b>{title}</b><small>{copy}</small></div><i /></article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
