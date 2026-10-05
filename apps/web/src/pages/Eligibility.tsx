import { useEffect, useState } from 'react';
import { api } from '../api';
import { CycleSelector } from '../components/CycleSelector';

type EligibilityResult = {
  studentId: string;
  name: string;
  isEligible: boolean;
  failedRules?: Array<{ field: string; message: string }>;
  evaluatedAt: string;
};

type CycleConfig = {
  selectionCycleId: string;
  rules?: unknown[];
};

export function Eligibility() {
  const [results, setResults] = useState<EligibilityResult[]>([]);
  const [failures, setFailures] = useState<Array<{ studentId: string; name: string; reasons: string[]; evaluatedAt: string }>>([]);
  const [cycleId, setCycleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function loadFailures() {
    try {
      const data = await api.get<any[]>('/reports/eligibility-failures');
      if (Array.isArray(data)) setFailures(data);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load eligibility data'); }
  }

  useEffect(() => { void loadFailures(); }, []);

  async function runEvaluation() {
    if (!cycleId) { setNotice('Enter a selection cycle ID'); return; }
    setBusy(true);
    try {
      const res = await api.post<any[]>('/eligibility/evaluate', { selectionCycleId: cycleId });
      const arr = Array.isArray(res) ? res : [];
      const eligible = arr.filter((r: any) => r.isEligible).length;
      setNotice(`Evaluated ${arr.length} students: ${eligible} eligible, ${arr.length - eligible} ineligible`);
      await loadFailures();
    } catch (e: any) {
      setNotice(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKFLOW STEP 2</p>
          <h1>Eligibility Evaluation</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Run Eligibility Engine</h2>
        <p className="subtitle">The rule engine evaluates each student against the configured eligibility criteria.</p>
        <div className="toolbar">
          <CycleSelector value={cycleId} onChange={setCycleId} />
          <button className="btn primary" disabled={busy} onClick={runEvaluation}>
            Evaluate
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Eligibility Failures</h2>
        <p className="subtitle">{failures.length} students did not meet eligibility criteria</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Student ID</th>
              <th>Name</th>
              <th>Failure Reasons</th>
              <th>Evaluated</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((f) => (
              <tr key={f.studentId}>
                <td>{f.studentId}</td>
                <td>{f.name}</td>
                <td>
                  <div className="tag-row">
                    {f.reasons.map((r, i) => <span key={i} className="tag warning">{r}</span>)}
                  </div>
                </td>
                <td>{new Date(f.evaluatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {failures.length === 0 && (
              <tr><td colSpan={4} className="empty-cell">No failures recorded. Run eligibility evaluation first.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
