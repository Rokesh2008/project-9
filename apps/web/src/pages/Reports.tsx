import { useEffect, useState } from 'react';
import { api } from '../api';

type AuditEntry = {
  type: string;
  actorId: string;
  role: string;
  studentId: string;
  details: Record<string, unknown>;
  at: string;
  source: string;
};

type Performance = {
  studentId: string;
  name: string;
  communicationAttempts: number;
  latestCommunicationScore: number | null;
  interviewAttempts: number;
  latestInterviewScore: number | null;
  latestInterviewOutcome: string | null;
};

export function Reports() {
  const [tab, setTab] = useState<'audit' | 'performance'>('audit');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [performance, setPerformance] = useState<Performance[]>([]);

  const [error, setError] = useState('');

  useEffect(() => {
    api.get<AuditEntry[]>('/reports/audit-trail').then((d) => Array.isArray(d) && setAudit(d)).catch((e: any) => setError(e.message ?? 'Failed to load audit trail'));
    api.get<Performance[]>('/reports/external-performance').then((d) => Array.isArray(d) && setPerformance(d)).catch((e: any) => setError(e.message ?? 'Failed to load performance data'));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">REPORTING</p>
          <h1>Reports</h1>
        </div>
        <div className="btn-group">
          <a className="btn" href="/api/reports/selection.csv" download>Selection CSV</a>
          <a className="btn" href="/api/reports/domain-capacity.csv" download>Capacity CSV</a>
        </div>
      </header>

      {error && <div className="notice">{error}</div>}

      <div className="tab-bar">
        <button className={`tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>Audit Trail</button>
        <button className={`tab ${tab === 'performance' ? 'active' : ''}`} onClick={() => setTab('performance')}>External Performance</button>
      </div>

      {tab === 'audit' && (
        <section className="card">
          <h2>Audit Trail</h2>
          <p className="subtitle">{audit.length} entries (most recent first)</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Actor</th>
                <th>Student</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {audit.slice(0, 50).map((a, i) => (
                <tr key={i}>
                  <td>{new Date(a.at).toLocaleString()}</td>
                  <td><span className="tag">{a.type}</span></td>
                  <td>{a.actorId}</td>
                  <td>{a.studentId}</td>
                  <td>{a.source}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">No audit entries.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'performance' && (
        <section className="card">
          <h2>External Performance</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Name</th>
                <th>Comm. Attempts</th>
                <th>Comm. Score</th>
                <th>Interview Attempts</th>
                <th>Interview Score</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((p) => (
                <tr key={p.studentId}>
                  <td>{p.studentId}</td>
                  <td>{p.name}</td>
                  <td>{p.communicationAttempts}</td>
                  <td>{p.latestCommunicationScore ?? '-'}</td>
                  <td>{p.interviewAttempts}</td>
                  <td>{p.latestInterviewScore ?? '-'}</td>
                  <td>{p.latestInterviewOutcome ? <span className={`pill ${p.latestInterviewOutcome.toLowerCase()}`}>{p.latestInterviewOutcome}</span> : '-'}</td>
                </tr>
              ))}
              {performance.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No external performance data.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
