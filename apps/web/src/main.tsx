import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './extras.css';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

type Summary = {
  totalStudents: number;
  interviewEligible: number;
  selected: number;
  allocated: number;
  integrationFailures: number;
};
type Log = { id: string; source: string; operation: string; method: string; status: string; recordCount: number; endedAt: string };
type Capacity = { domain: string; capacity: number; demand: number; allocated: number; available: number };
type Recommendation = { id: string; studentId: string; recommendedDomain: string; rationale: string[]; conflicts: string[]; status: string };
type Analysis = { strengths: string[]; gaps: string[]; trend: string; recommendedDomains: Array<{ domain: string; score: number; reason: string }> };
type Student = { studentId: string; registerNumber: string; name: string; program: string; codingScore: number; attendancePercent: number; interviewEligible: boolean; selected: boolean; allocation?: string; advisoryAnalysis?: Analysis };
type Anomaly = { studentId: string; severity: string; type: string; detail: string };

function App() {
  const [summary, setSummary] = useState<Summary>({ totalStudents: 0, interviewEligible: 0, selected: 0, allocated: 0, integrationFailures: 0 });
  const [logs, setLogs] = useState<Log[]>([]);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [whatIf, setWhatIf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready for synchronized intake');

  async function refresh() {
    try {
      const [s, l, c, r, st, a] = await Promise.all([
        fetch(`${API}/reports/selection-summary`).then((x) => x.json()),
        fetch(`${API}/integrations/logs`).then((x) => x.json()),
        fetch(`${API}/reports/domain-capacity`).then((x) => x.json()),
        fetch(`${API}/agent/selection/recommendations`).then((x) => x.json()),
        fetch(`${API}/students`).then((x) => x.json()),
        fetch(`${API}/ai/anomalies`).then((x) => x.json()),
      ]);
      setSummary(s); setLogs(l); setCapacities(c); setRecommendations(r); setStudents(st); setAnomalies(a);
    } catch { setNotice('API unavailable - start the stack to activate live monitoring'); }
  }

  useEffect(() => { void refresh(); }, []);

  async function importFile(file: File) {
    setBusy(true);
    const data = new FormData(); data.append('file', file);
    const response = await fetch(`${API}/integrations/import/excel`, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: data,
    });
    const result = await response.json();
    setNotice(response.ok ? `Imported ${result.imported} records through the canonical pipeline` : result.message ?? 'Import failed');
    setBusy(false); await refresh();
  }

  async function runAgent() {
    setBusy(true);
    const response = await fetch(`${API}/agent/selection/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const result = await response.json();
    setNotice(`Agent analyzed ${result.eligiblePoolSize ?? 0} eligible students; approval remains required`);
    setBusy(false); await refresh();
  }

  async function prepareDemo() {
    setBusy(true);
    const response = await fetch(`${API}/demo/run-dependency-simulation`, { method: 'POST' });
    const result = await response.json();
    setNotice(response.ok
      ? `Standalone dependencies ready: ${result.eligibility.eligible} eligible, ${result.project8.selected} selected`
      : result.message ?? 'Dependency simulation failed');
    setBusy(false); await refresh();
  }

  async function analyze(studentId: string) {
    setBusy(true);
    const response = await fetch(`${API}/ai/students/${studentId}/analyze`, { method: 'POST' });
    const result = await response.json();
    setNotice(response.ok ? `${studentId}: ${result.trend} profile; ${result.recommendedDomains.length} domain recommendations` : result.message);
    setBusy(false); await refresh();
  }

  async function simulateImprovement(student: Student) {
    const response = await fetch(`${API}/ai/students/${student.studentId}/what-if`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codingScore: Math.min(100, student.codingScore + 10), attendancePercent: Math.max(80, student.attendancePercent) }),
    });
    const result = await response.json();
    setWhatIf((current) => ({ ...current, [student.studentId]: result.projected?.interviewEligible
      ? `Projected eligible · fit ${result.projected.recommendationScore}`
      : result.projected?.reasons?.join(', ') ?? result.message }));
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    const response = await fetch(`${API}/agent/selection/recommendations/${id}/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-role': 'PLACEMENT_COORDINATOR' },
      body: JSON.stringify({ approverId: 'demo-admin', decision }),
    });
    const result = await response.json();
    setNotice(response.ok ? `Recommendation ${result.status.toLowerCase()}` : result.message);
    setBusy(false); await refresh();
  }

  const topCapacity = useMemo(() => capacities.slice().sort((a, b) => b.demand - a.demand).slice(0, 6), [capacities]);
  const maxCapacity = Math.max(1, ...topCapacity.map((item) => item.capacity));

  return <div className="shell">
    <aside>
      <div className="brand"><span>P9</span><div><strong>Selection OS</strong><small>Member 3 · Command Center</small></div></div>
      <nav>
        <a className="active" href="#overview">Overview</a>
        <a href="#integrations">Integrations</a>
        <a href="#students">Student intelligence</a>
        <a href="#intelligence">AI intelligence</a>
        <a href="#capacity">Capacity analytics</a>
      </nav>
      <div className="guardrail"><b>Advisory boundary</b><p>AI can recommend and explain. Only an authorized approval can change allocation.</p></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">PEP / HOPE OPERATIONS</p><h1>Integration command center</h1></div><div className="headerActions"><button className="primary" disabled={busy} onClick={() => void prepareDemo()}>Prepare standalone demo</button><div className="status"><i />All services monitored</div></div></header>
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
          <div className="exports"><a href={`${API}/reports/selection.csv`}>Selection CSV</a><a href={`${API}/reports/domain-capacity.csv`}>Capacity CSV</a></div>
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
