import { useEffect, useState } from 'react';
import { api } from '../api';
import { getUser } from '../auth';

type Recommendation = {
  id: string;
  studentId: string;
  recommendedDomain: string;
  rationale: string[];
  conflicts: string[];
  status: string;
  approvedBy?: string;
  approvedAt?: string;
};

export function Intelligence() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [analyzeId, setAnalyzeId] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);

  async function loadRecs() {
    try {
      const data = await api.get<Recommendation[]>('/agent/selection/recommendations');
      if (Array.isArray(data)) setRecommendations(data);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load recommendations'); }
  }

  useEffect(() => { void loadRecs(); }, []);

  async function runAgent() {
    setBusy(true);
    try {
      const res = await api.post<any>('/agent/selection/run', {});
      setNotice(`Agent processed ${res.eligiblePoolSize ?? 0} eligible students, ${res.recommendations?.length ?? 0} recommendations`);
      await loadRecs();
    } catch (e: any) { setNotice(e.message); }
    setBusy(false);
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    try {
      const user = getUser();
      await api.post(`/agent/selection/recommendations/${id}/decision`, { approverId: user?.id ?? 'unknown', decision });
      setNotice(`Recommendation ${decision.toLowerCase()}d`);
      await loadRecs();
    } catch (e: any) { setNotice(e.message); }
    setBusy(false);
  }

  async function analyzeStudent() {
    if (!analyzeId) return;
    setBusy(true);
    try {
      const res = await api.post<any>(`/ai/students/${analyzeId}/analyze`);
      setAnalysis(res);
      setNotice(`${analyzeId}: ${res.trend} profile`);
    } catch (e: any) { setNotice(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">HUMAN-IN-THE-LOOP</p>
          <h1>AI Advisory Intelligence</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <div className="advisory-banner">
        AI output is advisory only. All allocation decisions require authorized human approval.
      </div>

      <section className="card">
        <h2>Student Analysis</h2>
        <div className="toolbar">
          <input className="search-input" placeholder="Student ID (e.g. S-001)" value={analyzeId} onChange={(e) => setAnalyzeId(e.target.value)} />
          <button className="btn primary" disabled={busy} onClick={analyzeStudent}>Analyze</button>
        </div>
        {analysis && (
          <div className="analysis-result">
            <div className="analysis-grid">
              <div>
                <h3>Trend</h3>
                <span className={`pill ${analysis.trend === 'STRONG' ? 'succeeded' : analysis.trend === 'AT_RISK' ? 'failed' : 'pending'}`}>
                  {analysis.trend}
                </span>
              </div>
              <div>
                <h3>Strengths</h3>
                <div className="tag-row">{analysis.strengths?.map((s: string, i: number) => <span key={i} className="tag success">{s}</span>)}</div>
              </div>
              <div>
                <h3>Gaps</h3>
                <div className="tag-row">{analysis.gaps?.map((g: string, i: number) => <span key={i} className="tag warning">{g}</span>)}</div>
              </div>
              <div>
                <h3>Recommended Domains</h3>
                {analysis.recommendedDomains?.map((d: any, i: number) => (
                  <div key={i} className="domain-rec">
                    <b>{d.domain}</b> <span className="score">Score: {d.score}</span>
                    <small>{d.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Selection Agent Recommendations</h2>
          <button className="btn primary" disabled={busy} onClick={runAgent}>Run Agent</button>
        </div>
        <div className="flow-steps">
          <span>Read pool</span><span className="arrow">&rarr;</span>
          <span>Analyze</span><span className="arrow">&rarr;</span>
          <span>Detect conflicts</span><span className="arrow">&rarr;</span>
          <span>Recommend</span><span className="arrow">&rarr;</span>
          <span className="approval-step">Approval</span><span className="arrow">&rarr;</span>
          <span>Verify</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Domain</th>
              <th>Rationale</th>
              <th>Conflicts</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((r) => (
              <tr key={r.id}>
                <td>{r.studentId}</td>
                <td>{r.recommendedDomain}</td>
                <td><small>{r.rationale.join(' | ')}</small></td>
                <td>{r.conflicts.length > 0
                  ? <span className="tag warning">{r.conflicts.join(', ')}</span>
                  : <span className="tag success">None</span>
                }</td>
                <td><span className={`pill ${r.status.toLowerCase().replace('_', '-')}`}>{r.status}</span></td>
                <td>
                  {r.status === 'PENDING_APPROVAL' && (
                    <div className="btn-group">
                      <button className="btn small success" disabled={busy || r.conflicts.length > 0} onClick={() => decide(r.id, 'APPROVE')}>Approve</button>
                      <button className="btn small danger" disabled={busy} onClick={() => decide(r.id, 'REJECT')}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {recommendations.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No recommendations. Run the agent after eligibility evaluation.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
