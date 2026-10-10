import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
const AllocationAdmin = lazy(() => import('./AllocationAdmin').then(m=>({default:m.AllocationAdmin})));
const AccountsAdmin = lazy(() => import('./AccountsAdmin').then(m=>({default:m.AccountsAdmin})));
const SelectionRules = lazy(() => import('./SelectionRules').then(m=>({default:m.SelectionRules})));
const ExternalScores = lazy(() => import('./ExternalScores').then(m=>({default:m.ExternalScores})));
import type { CurrentUser } from './Portals';
const FacultyPortal = lazy(() => import('./Portals').then(m=>({default:m.FacultyPortal})));
const StudentPortal = lazy(() => import('./Portals').then(m=>({default:m.StudentPortal})));
const ProfileView = lazy(() => import('./Portals').then(m=>({default:m.ProfileView})));
import { API, TOKEN_KEY, apiFetch, clearSession } from './api';
import { Icon, WorkspaceShell } from './WorkspaceShell';
import { CollegeBrand } from './CollegeBrand';
import { StudentDirectory } from './StudentDirectory';
const SelectionDemo = lazy(() => import('./SelectionDemo').then(m=>({default:m.SelectionDemo})));
const CycleManagement = lazy(() => import('./CycleManagement').then(m=>({default:m.CycleManagement})));
import './ui.css';
import './college.css';
import './portals.css';

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
  const [view, setView] = useState<'member3' | 'allocations' | 'accounts' | 'directory' | 'rules' | 'demo' | 'cycles'>('directory');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary>({ totalStudents: 0, interviewEligible: 0, selected: 0, allocated: 0, integrationFailures: 0 });
  const [logs, setLogs] = useState<Log[]>([]);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [whatIf, setWhatIf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready for synchronized intake');
  const [loginRequired, setLoginRequired] = useState(!localStorage.getItem(TOKEN_KEY));
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('ALL');
  const [candidatePage, setCandidatePage] = useState(1);
  const [activeSection, setActiveSection] = useState('overview');

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
      // The default paginated directory needs no full-cohort/advisory payload.
      // Fetch those only when their workspace is actually opened.
      if (view !== 'member3') {
        setSummary(await requestJson<Summary>(`${API}/reports/selection-summary`));
        return;
      }
      await Promise.all([
        requestJson<Summary>(`${API}/reports/selection-summary`).then(setSummary),
        requestJson<Log[]>(`${API}/integrations/logs`).then(setLogs),
        requestJson<Capacity[]>(`${API}/reports/domain-capacity`).then(setCapacities),
        requestJson<Recommendation[]>(`${API}/agent/selection/recommendations`).then(setRecommendations),
        requestJson<Student[]>(`${API}/students`).then(setStudents),
        requestJson<Anomaly[]>(`${API}/ai/anomalies`).then(setAnomalies),
      ]);
      setLoginRequired(false);
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') return;
      setNotice(error instanceof Error ? error.message : 'API unavailable');
    }
  }

  async function initialize() {
    try {
      const account = await requestJson<CurrentUser>(`${API}/auth/me`);
      setUser(account);
      setLoginRequired(false);
      if (account.role === 'ADMIN' || account.role === 'COORDINATOR') await refresh();
    } catch {
      setUser(null);
      setLoginRequired(true);
    }
  }

  useEffect(() => { if (localStorage.getItem(TOKEN_KEY)) void initialize(); }, []);
  useEffect(() => { if(user && (user.role==='ADMIN'||user.role==='COORDINATOR') && view==='member3') void refresh(); }, [view,user?.email]);
  useEffect(() => { setCandidatePage(1); }, [studentSearch,studentFilter,students]);

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
      await initialize();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearSession();
    setUser(null);
    setView('member3');
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

  const matchingStudents = useMemo(() => students.filter(student => `${student.name} ${student.studentId} ${student.registerNumber}`.toLowerCase().includes(studentSearch.toLowerCase()) &&
    (studentFilter === 'ALL' || student.program === studentFilter)),[students,studentSearch,studentFilter]);
  const candidatePages=Math.max(1,Math.ceil(matchingStudents.length/50));
  const safeCandidatePage=Math.min(candidatePage,candidatePages);
  const filteredStudents=matchingStudents.slice((safeCandidatePage-1)*50,safeCandidatePage*50);
  if (loginRequired) {
    return <div className="loginPage">
      <div className="loginIntro"><div className="loginBrand"><CollegeBrand portal="An Autonomous Institution" /></div><p className="eyebrow">PEP / HOPE · STUDENT SELECTION</p><h1>Your potential.<br />Your next step.</h1><p>The college’s selection and allocation workspace. Track your results, understand every decision, and plan your next steps.</p><div className="loginFeatures"><span><Icon name="check" />Clear selection results and next steps</span><span><Icon name="users" />Dedicated student & faculty portals</span><span><Icon name="shield" />Domain-based faculty approvals</span></div><small>St. Joseph’s College of Engineering · <a href="https://stjosephs.ac.in/" target="_blank" rel="noopener noreferrer">College website ↗</a></small></div>
      <div className="loginFormArea"><form className="loginForm" onSubmit={(event) => void login(event)}>
        <span className="loginEmblem"><Icon name="shield" size={28} /></span><h1>Welcome back</h1><p className="portalMuted">Students: use your roll number. Faculty and administrators: use your account email.</p>
        {notice && notice !== 'Ready for synchronized intake' && <p className="portalNotice" role="status">{notice}</p>}
        <label>Roll number or account email<input aria-label="Roll number or account email" autoComplete="username" type="text" required placeholder="Enter roll number or email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} /></label>
        <label>Password<input aria-label="Password" autoComplete="current-password" type="password" required placeholder="Enter your password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} /></label>
        <button className="primary dark" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in to workspace'}<Icon name="arrow" size={17} /></button>
        <p className="loginHelp"><Icon name="lock" size={14} />Access is managed by your administrator.</p>
      </form></div>
    </div>;
  }

  if (!user) return <div className="portalShell">Checking your account…</div>;
  if (user.role === 'STUDENT') return <StudentPortal user={user} onSignOut={logout} />;
  if (user.role === 'PEP_STAFF') return <FacultyPortal user={user} onSignOut={logout} />;

  const section = (id: string) => { setView('member3'); setActiveSection(id); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 0); };
  return <WorkspaceShell account={user.email} role={user.role === 'ADMIN' ? 'Administrator' : 'Coordinator'} cycle={summary.selectionCycleId} onSignOut={logout}
    actions={view==='demo'?<span className="outlineBadge">SYNTHETIC DEMO ONLY</span>:view==='cycles'?<span className="outlineBadge">DRAFT → REVIEW → ACTIVATE</span>:<><button className="ghost" disabled={busy} onClick={() => void refresh()}><Icon name="refresh" size={16} />Refresh data</button><button className="primary dark" disabled={busy || !summary.selectionCycleId} onClick={() => void runOfficialSelection()}><Icon name="play" size={17} />Run selection</button></>}
    items={[
      { label: 'Selection Overview', icon: 'shield', active: view === 'member3' && activeSection === 'overview', onClick: () => section('overview') },
      { label: 'Intake Pipeline', icon: 'intake', active: view === 'member3' && activeSection === 'integrations', onClick: () => section('integrations') },
      { label: 'Current Cycle Results', icon: 'nodes', active: view === 'member3' && activeSection === 'students', onClick: () => section('students') },
      { label: 'Advisory Allocation', icon: 'check', active: view === 'member3' && activeSection === 'intelligence', onClick: () => section('intelligence') },
      { label: 'Domain Capacities', icon: 'chart', active: view === 'member3' && activeSection === 'capacity', onClick: () => section('capacity') },
      { label: 'Allocation & Freeze', icon: 'lock', active: view === 'allocations', onClick: () => setView('allocations') },
      { label: 'Student Directory', icon: 'users', active: view === 'directory', onClick: () => setView('directory') },
      ...(user.role === 'ADMIN' ? [{ label: 'Live Rules Demo', icon: 'play', active: view === 'demo', onClick: () => setView('demo') }] : []),
      ...(user.role === 'ADMIN' ? [{ label: 'Selection Rules', icon: 'shield', active: view === 'rules', onClick: () => setView('rules') }] : []),
      ...(user.role === 'ADMIN' ? [{ label: 'Selection Cycles', icon: 'nodes', active: view === 'cycles', onClick: () => setView('cycles') }] : []),
      ...(user.role === 'ADMIN' ? [{ label: 'Account Management', icon: 'users', active: view === 'accounts', onClick: () => setView('accounts') }] : []),
    ]}>
    {view === 'cycles' && user.role === 'ADMIN' ? <CycleManagement onActivated={refresh} /> : view === 'demo' && user.role === 'ADMIN' ? <SelectionDemo user={user} /> : view === 'rules' && user.role === 'ADMIN' ? <SelectionRules user={user} /> : view === 'accounts' && user.role === 'ADMIN' ? <AccountsAdmin /> : view === 'allocations' ? <AllocationAdmin initialCycleId={summary.selectionCycleId} /> : view === 'directory' ? <><StudentDirectory onOpenProfile={setSelectedStudentId} />{selectedStudentId && <section className="rosterProfile"><button className="ghost" onClick={() => setSelectedStudentId(null)}>Close profile</button><ProfileView studentId={selectedStudentId} /></section>}</> : <>
      <header id="overview" className="commandHero"><div><p className="eyebrow">ST. JOSEPH’S / SELECTION & ALLOCATION</p><h1>Student Selection<br />Overview</h1><p className="heroMeta"><span className="dot" />{summary.selectionCycleId ? 'Active selection cycle' : 'Awaiting selection cycle'}<span>·</span>Rule-based selection · Faculty approval</p></div><div className="heroActions"><span className="outlineBadge">PEP / HOPE SELECTION</span><button className="primary" disabled={busy} onClick={() => section('intelligence')}><Icon name="arrow" size={16} />Review advisory queue</button></div></header>
      <section className="notice"><span>{notice}</span><button onClick={() => void refresh()}>Refresh</button></section>
      <section className="panel lifecyclePanel"><div className="panelHead"><h2><Icon name="nodes" />Selection Lifecycle Stage Progression</h2><span className="portalMuted">Current cycle snapshot</span></div><div className="lifecycleCards">{[
        ['Intake', `${summary.totalStudents} students`, 'Project 2 API or CSV', summary.totalStudents > 0],
        ['Eligibility', `${students.filter(student => ['HOPE', 'PEP', 'WAITLIST'].includes(student.program)).length} passed`, 'Configured prerequisite rules', summary.selected > 0],
        ['Score & Rank', 'Weighted scoring', 'Versioned scoring parameters', summary.selected > 0],
        ['HOPE / PEP', `${summary.selected} classified`, 'Program placement', summary.selected > 0],
        ['External Sync', `${logs.length} transfer jobs`, 'Communication & interviews', logs.some(l => l.status === 'SUCCEEDED')],
        ['Advisory Match', `${recommendations.filter(r => r.status === 'PENDING_APPROVAL').length} awaiting review`, 'Domain recommendations', recommendations.length > 0],
        ['Allocation', `${summary.allocated} verified`, 'Approval & finalization', summary.allocated > 0],
      ].map(([label, value, copy, hasRecords], index) => <article key={String(label)} className={hasRecords ? 'hasRecords' : ''} title={hasRecords ? 'Records are available for this stage; individual progress may vary.' : 'No records available yet for this stage.'}><div><small>STAGE {index + 1}</small><Icon name={index === 6 ? 'lock' : 'nodes'} size={16} /></div><h3>{label}</h3><b>{value}</b><p>{copy}</p><span className="stageLine" /></article>)}</div></section>
      <section className="metrics">
        <Metric label="Total intake enrollment" value={summary.totalStudents} tone="cyan" />
        <Metric label="Interview eligible" value={summary.interviewEligible} tone="violet" />
        <Metric label="Verified allocations" value={summary.allocated} tone="green" />
        <Metric label="Integration failures" value={summary.integrationFailures} tone={summary.integrationFailures ? 'orange' : 'neutral'} />
      </section>
      <div className="grid">
        <section id="integrations" className="panel span2">
          <div className="panelHead"><div><p className="eyebrow">INTAKE PIPELINE</p><h2>External system exchange</h2></div>
            <label className="upload">{busy ? 'Working…' : 'Import CSV / XLSX'}<input disabled={busy} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} /></label>
          </div>
          <ExternalScores onSynced={refresh} />
          <div className="sources">
            <Source code="P2" title="Readiness data" copy="Student and assessment ingestion" />
            <Source code="P1" title="Communication" copy="Eligible export and result return" />
            <Source code="P8" title="Interview" copy="Attempt history without overwrite" />
            <Source code="XL" title="Manual fallback" copy="Same DTO and validation path" />
          </div>
          <div className="tableScroll"><table><thead><tr><th>Source</th><th>Operation</th><th>Method</th><th>Records</th><th>Status</th></tr></thead>
            <tbody>{logs.slice(0, 5).map((log) => <tr key={log.id}><td>{log.source}</td><td>{log.operation}</td><td>{log.method}</td><td>{log.recordCount}</td><td><span className={`pill ${log.status.toLowerCase()}`}>{log.status}</span></td></tr>)}
              {!logs.length && <tr><td colSpan={5} className="empty">No transfer jobs yet. Import the provided CSV template to start.</td></tr>}
            </tbody></table></div>
        </section>
        <section id="capacity" className="panel">
          <div className="panelHead"><div><p className="eyebrow">CAPACITY SIGNAL</p><h2>Domain load</h2></div><b>{capacities.reduce((sum, x) => sum + x.capacity, 0)} seats</b></div>
          <div className="bars">{topCapacity.map((item) => <div className="barRow" key={item.domain}><div><span>{item.domain.replace(/^PEPC-\d+ /, '')}</span><b>{item.demand}/{item.capacity}</b></div><div className="bar"><i style={{ width: `${Math.max(3, item.capacity / maxCapacity * 100)}%` }}><em style={{ width: `${Math.min(100, item.demand / Math.max(1, item.capacity) * 100)}%` }} /></i></div></div>)}</div>
          <div className="exports"><button onClick={() => void downloadReport('/reports/selection.csv', 'selection-report.csv')}>Selection CSV</button><button onClick={() => void downloadReport('/reports/domain-capacity.csv', 'domain-capacity-report.csv')}>Capacity CSV</button></div>
        </section>
        <section id="students" className="panel span3">
          <div className="panelHead"><div><p className="eyebrow">CURRENT SELECTION CYCLE ONLY</p><h2>Cycle Classification Results</h2><p className="portalMuted">These are cycle results, not the complete student directory.</p></div><span className="outlineBadge">{students.length} cycle records</span></div>
          <div className="ledgerToolbar"><div className="ledgerTabs">{[['ALL', 'All'], ['HOPE', 'HOPE'], ['PEP', 'PEP'], ['WAITLIST', 'Waitlist'], ['NOT_ELIGIBLE', 'Not eligible']].map(([key, label]) => <button key={key} className={studentFilter === key ? 'active' : 'ghost'} onClick={() => setStudentFilter(key)}>{label}</button>)}</div><label className="searchField"><Icon name="search" size={17} /><input aria-label="Filter student ledger" placeholder="Search candidate name, ID, or register number" value={studentSearch} onChange={event => setStudentSearch(event.target.value)} /></label></div>
          <div className="studentTable"><table><thead><tr><th>Student</th><th>Program</th><th>Coding</th><th>Attendance</th><th>Interview queue</th><th>Classification</th><th>Recommendation</th><th>Actions</th></tr></thead><tbody>
            {filteredStudents.map((student) => <tr key={student.studentId}><td><button className="textButton" onClick={() => setSelectedStudentId(student.studentId)}>{student.name}</button><small>{student.studentId} · {student.registerNumber}</small></td><td>{student.program}</td><td>{student.codingScore}</td><td>{student.attendancePercent}%</td><td><span className={`pill ${student.interviewEligible ? 'verified' : 'neutral'}`}>{student.interviewEligible ? 'READY' : 'NOT IN QUEUE'}</span></td><td><span className={`pill ${student.selected ? 'succeeded' : 'neutral'}`}>{student.program === 'UNASSIGNED' ? 'PENDING' : student.program.replaceAll('_', ' ')}</span></td><td>{student.allocation ?? student.advisoryAnalysis?.recommendedDomains?.[0]?.domain ?? 'Not analyzed'}{student.advisoryAnalysis && <small>{student.advisoryAnalysis.trend} · Advisory</small>}{whatIf[student.studentId] && <small className="whatIf">{whatIf[student.studentId]}</small>}</td><td><div className="rowActions"><button disabled={busy} onClick={() => void analyze(student.studentId)}>Analyze</button><button className="ghost" onClick={() => void simulateImprovement(student)}>What-if +10</button></div></td></tr>)}
            {!filteredStudents.length && <tr><td colSpan={8} className="empty">{students.length ? "No candidates match these filters." : "Import a CSV to add student profiles."}</td></tr>}
          </tbody></table></div>
          <div className="directoryPages"><button className="ghost" disabled={safeCandidatePage<=1} onClick={()=>setCandidatePage(safeCandidatePage-1)}>Previous candidates</button><span>Page {safeCandidatePage} of {candidatePages} · {matchingStudents.length} matching candidates · 50 per page</span><button className="ghost" disabled={safeCandidatePage>=candidatePages} onClick={()=>setCandidatePage(safeCandidatePage+1)}>Next candidates</button></div>
          <div className="analysisGrid">{students.filter((student) => student.advisoryAnalysis).slice(0, 4).map((student) => <article key={student.studentId}><div><small>{student.studentId}</small><h3>{student.name}</h3></div><div><b>Strengths</b><p>{student.advisoryAnalysis!.strengths.join(' · ') || 'No strong signal yet'}</p></div><div><b>Gaps</b><p>{student.advisoryAnalysis!.gaps.join(' · ') || 'No material gaps detected'}</p></div></article>)}</div>
        </section>
        {selectedStudentId && <section className="panel span3"><div className="panelHead"><h2>Selection explanation · {selectedStudentId}</h2><button onClick={() => setSelectedStudentId(null)}>Close profile</button></div><ProfileView studentId={selectedStudentId} /></section>}
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
    </>}
  </WorkspaceShell>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`metric ${tone}`}><span>{label}</span><b>{value.toLocaleString()}</b><small>Current selection cycle</small></article>;
}
function Source({ code, title, copy }: { code: string; title: string; copy: string }) {
  return <article className="source"><span>{code}</span><div><b>{title}</b><small>{copy}</small></div><i /></article>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<main className="notice" role="status">Loading workspace…</main>}><App /></Suspense></React.StrictMode>);
