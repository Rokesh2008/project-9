import { useEffect, useState } from 'react';
import { api } from '../api';
import { getUser } from '../auth';

type Student = {
  id: string;
  studentId: string;
  name: string;
  email: string;
  contactNo?: string;
  isActive: boolean;
  department?: string;
  departmentCode?: string;
  batch?: { batchIdentifier: string; department?: { code: string; name: string } };
  assessmentResults?: Array<{ id: string; assessmentType: string; sourceIdentifier: string; score: number; maxScore: number; attemptNumber: number; createdAt: string }>;
  preferences?: Array<{ domain?: { name: string; code: string }; preferenceRank: number }>;
  eligibilityResults?: Array<{ isEligible: boolean; failedRules?: any[]; evaluatedAt: string }>;
  studentRankings?: Array<{ rank: number; totalScore: number; percentile?: number; calculatedAt: string }>;
  hopePepClassifications?: Array<{ program: string; rank: number; status: string; classifiedAt: string }>;
  allocations?: Array<{ status: string; preferenceRankUsed?: number; isFinalized: boolean; isFrozen: boolean; domain?: { name: string; code: string }; trainingBatch?: { batchCode: string }; selectionCycle?: { code: string } }>;
  cycleStatuses?: Array<{ currentState: string; isFrozen: boolean; selectionCycle?: { code: string; name: string } }>;
  adminDecisions?: Array<{ decisionType: string; reason: string; actor: string; role: string; createdAt: string }>;
  workflowAudits?: Array<{ fromState: string; toState: string; actor: string; role: string; reason?: string; createdAt: string }>;
};

const WORKFLOW_STEPS = ['IMPORTED', 'ELIGIBILITY', 'HOPE_PEP', 'COMMUNICATION', 'INTERVIEW', 'SELECTION', 'ALLOCATION', 'ADMIN_REVIEW', 'FINALIZED', 'FROZEN'];

export function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const pageSize = 20;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const res = await api.get<any>(`/students?${params}`);
      if (Array.isArray(res)) {
        setStudents(res);
        setTotal(res.length);
      } else if (res?.data) {
        setStudents(res.data);
        setTotal(res.total ?? res.data.length);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load students');
      setStudents([]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [page, search]);

  async function loadDetail(id: string) {
    try {
      const detail = await api.get<Student>(`/students/${id}`);
      setSelected(detail);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load student details');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT MANAGEMENT</p>
          <h1>Students</h1>
        </div>
        <div className="header-actions">
          <span className="subtitle">{total} records</span>
          <button className="btn primary" onClick={() => setShowCreate(true)}>Create Student</button>
        </div>
      </header>

      {error && <div className="notice">{error}</div>}

      {showCreate && <CreateStudentForm onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, ID, or email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <div className="split-view">
        <section className="card flex-2">
          {loading ? (
            <p className="empty-state">Loading students...</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className={selected?.id === s.id ? 'selected' : ''}>
                      <td>{s.studentId}</td>
                      <td>{s.name}</td>
                      <td>{s.departmentCode ?? s.batch?.department?.code ?? '-'}</td>
                      <td>
                        <span className={`pill ${s.isActive ? 'succeeded' : 'neutral'}`}>
                          {s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button className="btn small" onClick={() => loadDetail(s.id)}>View</button>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr><td colSpan={5} className="empty-cell">No students found. Import data to begin.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="pagination">
                <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
                <button className="btn small" disabled={students.length < pageSize} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </>
          )}
        </section>

        {selected && <StudentDetail student={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function StudentDetail({ student, onClose }: { student: Student; onClose: () => void }) {
  const currentState = student.cycleStatuses?.[0]?.currentState;
  const currentCycle = student.cycleStatuses?.[0]?.selectionCycle;
  const eligibility = student.eligibilityResults?.[0];
  const ranking = student.studentRankings?.[0];
  const classification = student.hopePepClassifications?.[0];
  const allocation = student.allocations?.[0];

  return (
    <section className="card flex-1 detail-panel">
      <div className="detail-header">
        <h2>{student.name}</h2>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
      <p className="subtitle">{student.studentId} | {student.email}</p>
      {student.department && <p className="subtitle">Department: {student.department}</p>}
      {currentCycle && <p className="subtitle">Cycle: {currentCycle.code} — {currentCycle.name}</p>}

      {currentState && (
        <div className="detail-section">
          <h3>Workflow Status</h3>
          <div className="workflow-timeline">
            {WORKFLOW_STEPS.map((step) => {
              const idx = WORKFLOW_STEPS.indexOf(step);
              const currentIdx = WORKFLOW_STEPS.indexOf(currentState);
              const status = idx < currentIdx ? 'completed' : idx === currentIdx ? 'current' : 'pending';
              return (
                <span key={step} className={`workflow-step ${status}`}>
                  {step.replace('_', ' ')}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>Assessment History</h3>
        {student.assessmentResults?.length ? (
          <table className="data-table compact">
            <thead><tr><th>Type</th><th>Score</th><th>Attempt</th><th>Date</th></tr></thead>
            <tbody>
              {student.assessmentResults.map((a) => (
                <tr key={a.id}>
                  <td>{a.assessmentType}</td>
                  <td>{a.score}/{a.maxScore}</td>
                  <td>#{a.attemptNumber}</td>
                  <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty-state">No assessments</p>}
      </div>

      <div className="detail-section">
        <h3>Eligibility</h3>
        {eligibility ? (
          <div>
            <span className={`pill ${eligibility.isEligible ? 'succeeded' : 'failed'}`}>
              {eligibility.isEligible ? 'Eligible' : 'Not Eligible'}
            </span>
            {!eligibility.isEligible && eligibility.failedRules && (
              <div className="tag-row" style={{ marginTop: '0.5rem' }}>
                {(eligibility.failedRules as any[]).map((r: any, i: number) => (
                  <span key={i} className="tag warning">{r.message ?? r.label ?? JSON.stringify(r)}</span>
                ))}
              </div>
            )}
            <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.7 }}>
              Evaluated: {new Date(eligibility.evaluatedAt).toLocaleString()}
            </small>
          </div>
        ) : <span className="pill neutral">Not Evaluated</span>}
      </div>

      {ranking && (
        <div className="detail-section">
          <h3>Ranking</h3>
          <div className="tag-row">
            <span className="tag">Rank: #{ranking.rank}</span>
            <span className="tag">Score: {ranking.totalScore.toFixed(2)}</span>
            {ranking.percentile != null && <span className="tag">Percentile: {ranking.percentile.toFixed(1)}%</span>}
          </div>
        </div>
      )}

      {classification && (
        <div className="detail-section">
          <h3>Classification</h3>
          <span className={`pill ${classification.program === 'HOPE' ? 'pending' : 'succeeded'}`}>
            {classification.program}
          </span>
          <span className="tag" style={{ marginLeft: '0.5rem' }}>Status: {classification.status}</span>
        </div>
      )}

      <div className="detail-section">
        <h3>Preferences</h3>
        {student.preferences?.length ? (
          <ol className="pref-list">
            {student.preferences.sort((a, b) => a.preferenceRank - b.preferenceRank).map((p, i) => (
              <li key={i}>{p.domain?.code} — {p.domain?.name ?? 'Unknown'}</li>
            ))}
          </ol>
        ) : <p className="empty-state">No preferences submitted</p>}
      </div>

      {allocation && (
        <div className="detail-section">
          <h3>Allocation</h3>
          <div className="tag-row">
            {allocation.domain && <span className="tag">{allocation.domain.code} — {allocation.domain.name}</span>}
            {allocation.trainingBatch && <span className="tag">Batch: {allocation.trainingBatch.batchCode}</span>}
            <span className={`pill ${allocation.status.toLowerCase().replace('_', '-')}`}>{allocation.status}</span>
            {allocation.preferenceRankUsed && <span className="tag">Pref #{allocation.preferenceRankUsed}</span>}
            {allocation.isFrozen && <span className="pill frozen">LOCKED</span>}
          </div>
        </div>
      )}

      {student.adminDecisions && student.adminDecisions.length > 0 && (
        <div className="detail-section">
          <h3>Admin Decisions</h3>
          {student.adminDecisions.map((d, i) => (
            <div key={i} className="audit-entry">
              <span className="tag">{d.decisionType}</span>
              <span>{d.reason}</span>
              <small>{d.actor} ({d.role}) — {new Date(d.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}

      {student.workflowAudits && student.workflowAudits.length > 0 && (
        <div className="detail-section">
          <h3>Audit Trail</h3>
          <div className="audit-list">
            {student.workflowAudits.slice(0, 15).map((a, i) => (
              <div key={i} className="audit-entry">
                <span className="tag">{a.fromState} → {a.toState}</span>
                {a.reason && <span>{a.reason}</span>}
                <small>{a.actor} ({a.role}) — {new Date(a.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function CreateStudentForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ studentId: '', name: '', email: '', department: 'CSE', contactNo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/students', {
        ...form,
        cgpa: 0,
        codingScore: 0,
        aptitudeScore: 0,
        attendancePercent: 0,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create student');
    }
    setBusy(false);
  }

  return (
    <section className="card" style={{ marginBottom: '1rem' }}>
      <h2>Create Student</h2>
      {error && <div className="notice">{error}</div>}
      <form onSubmit={handleSubmit} className="create-form">
        <label>
          Student ID
          <input required value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} placeholder="e.g. STU-2026-0001" />
        </label>
        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Department Code
          <input required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </label>
        <label>
          Contact No
          <input value={form.contactNo} onChange={(e) => setForm({ ...form, contactNo: e.target.value })} />
        </label>
        <div className="btn-group">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating...' : 'Create'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
