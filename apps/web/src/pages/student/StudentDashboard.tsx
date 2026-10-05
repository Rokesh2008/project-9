import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';

type DashboardData = {
  student: { id: string; name: string; studentId: string };
  cycle: { id: string; name: string; status: string } | null;
  workflowState: string | null;
  eligibility: { isEligible: boolean; failedRules: unknown[] } | null;
  ranking: { rank: number; percentile: number } | null;
  classification: { program: string; status: string } | null;
  allocation: { status: string; domain: string; domainCode: string; batch: string; isFrozen: boolean } | null;
  notificationCount: number;
};

export function StudentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<DashboardData>('/my/dashboard')
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><p className="empty-state">Loading...</p></div>;
  if (error) return <div className="page"><div className="notice">{error}</div></div>;
  if (!data) return null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>Welcome, {data.student.name}</h1>
        </div>
      </header>

      {!data.cycle ? (
        <div className="notice">No active selection cycle at this time.</div>
      ) : (
        <>
          <section className="card">
            <h2>Cycle: {data.cycle.name}</h2>
            <div className="tag-row">
              <span className="tag">Status: {data.cycle.status}</span>
              {data.workflowState && <span className="tag">Stage: {data.workflowState}</span>}
            </div>
          </section>

          <section className="metrics-grid">
            <article className={`metric-card ${data.eligibility?.isEligible ? 'green' : data.eligibility ? 'orange' : 'neutral'} clickable`} onClick={() => navigate('/student/eligibility')} style={{ cursor: 'pointer' }}>
              <span className="metric-label">Eligibility</span>
              <b className="metric-value">{data.eligibility ? (data.eligibility.isEligible ? 'Eligible' : 'Not Eligible') : 'Pending'}</b>
            </article>
            <article className={`metric-card ${data.ranking ? 'violet' : 'neutral'} clickable`} onClick={() => navigate('/student/ranking')} style={{ cursor: 'pointer' }}>
              <span className="metric-label">Rank</span>
              <b className="metric-value">{data.ranking ? `#${data.ranking.rank}` : 'Pending'}</b>
            </article>
            <article className={`metric-card ${data.classification ? 'blue' : 'neutral'} clickable`}>
              <span className="metric-label">Classification</span>
              <b className="metric-value">{data.classification?.program ?? 'Pending'}</b>
            </article>
            <article className={`metric-card ${data.allocation ? 'green' : 'neutral'} clickable`} onClick={() => navigate('/student/allocation')} style={{ cursor: 'pointer' }}>
              <span className="metric-label">Allocation</span>
              <b className="metric-value">{data.allocation?.domain ?? 'Pending'}</b>
            </article>
          </section>

          {data.notificationCount > 0 && (
            <section className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/student/notifications')}>
              <p>You have <strong>{data.notificationCount}</strong> unread notification{data.notificationCount > 1 ? 's' : ''}.</p>
            </section>
          )}
        </>
      )}

      <section className="card">
        <h2>Quick Links</h2>
        <div className="quick-actions">
          <button className="btn" onClick={() => navigate('/student/profile')}>My Profile</button>
          <button className="btn" onClick={() => navigate('/student/scores')}>My Scores</button>
          <button className="btn" onClick={() => navigate('/student/preferences')}>My Preferences</button>
          <button className="btn" onClick={() => navigate('/student/notifications')}>Notifications</button>
        </div>
      </section>
    </div>
  );
}
