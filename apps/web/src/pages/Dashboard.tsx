import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';

type Summary = {
  totalStudents: number;
  interviewEligible: number;
  selected: number;
  allocated: number;
  needsReview: number;
  integrationFailures: number;
  byProgram?: Record<string, number>;
};

type Capacity = {
  domain: string;
  domainName: string;
  capacity: number;
  demand: number;
  allocated: number;
  available: number;
  overSubscribed: boolean;
};

export function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = pathname.startsWith('/admin') ? '/admin' : pathname.startsWith('/staff') ? '/staff' : '';

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [s, c] = await Promise.all([
        api.get<Summary>('/reports/selection-summary'),
        api.get<Capacity[]>('/reports/domain-capacity'),
      ]);
      setSummary(s);
      if (Array.isArray(c)) setCapacities(c);
    } catch (e: any) {
      setError(e.message ?? 'Unable to load dashboard data');
    }
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  const topDomains = capacities.slice().sort((a, b) => b.demand - a.demand).slice(0, 8);
  const maxCap = Math.max(1, ...topDomains.map((d) => d.capacity));

  if (loading) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">PEP / HOPE OPERATIONS</p>
            <h1>Dashboard</h1>
          </div>
        </header>
        <p className="empty-state">Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">PEP / HOPE OPERATIONS</p>
            <h1>Dashboard</h1>
          </div>
        </header>
        <div className="notice">{error}</div>
        <button className="btn primary" onClick={() => void refresh()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">PEP / HOPE OPERATIONS</p>
          <h1>Dashboard</h1>
        </div>
        <button className="btn" onClick={() => void refresh()}>Refresh</button>
      </header>

      <section className="metrics-grid">
        <MetricCard label="Students" value={summary?.totalStudents ?? 0} tone="cyan" onClick={() => navigate(`${base}/students`)} />
        <MetricCard label="Eligible" value={summary?.interviewEligible ?? 0} tone="violet" onClick={() => navigate(`${base}/eligibility`)} />
        <MetricCard label="Selected" value={summary?.selected ?? 0} tone="blue" />
        <MetricCard label="Allocated" value={summary?.allocated ?? 0} tone="green" onClick={() => navigate(`${base}/allocations`)} />
        <MetricCard label="Needs Review" value={summary?.needsReview ?? 0}
          tone={summary?.needsReview ? 'orange' : 'neutral'} onClick={() => navigate(`${base}/allocations`)} />
        <MetricCard label="Integration Failures" value={summary?.integrationFailures ?? 0}
          tone={summary?.integrationFailures ? 'orange' : 'neutral'} onClick={() => navigate(`${base}/import`)} />
      </section>

      {summary?.byProgram && Object.keys(summary.byProgram).length > 0 && (
        <section className="card">
          <h2>By Program</h2>
          <div className="tag-row">
            {Object.entries(summary.byProgram).map(([prog, count]) => (
              <span key={prog} className="tag">{prog}: {count}</span>
            ))}
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <h2>Domain Capacity</h2>
          {topDomains.length > 0 ? (
            <div className="bar-chart">
              {topDomains.map((d) => (
                <div key={d.domain} className="bar-row">
                  <div className="bar-label">
                    <span>{d.domainName ?? d.domain.replace(/^PEPC-\d+\s*/, '')}</span>
                    <b>{d.allocated}/{d.capacity}</b>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.max(3, (d.capacity / maxCap) * 100)}%` }}>
                      <div className="bar-demand" style={{ width: `${Math.min(100, (d.allocated / Math.max(1, d.capacity)) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">No domains configured.</p>
          )}
        </section>

        <section className="card">
          <h2>Quick Actions</h2>
          <div className="quick-actions">
            <button className="btn" onClick={() => navigate(`${base}/import`)}>Import Data</button>
            <button className="btn" onClick={() => navigate(`${base}/eligibility`)}>Run Eligibility</button>
            <button className="btn" onClick={() => navigate(`${base}/scoring`)}>Compute Scores</button>
            <button className="btn" onClick={() => navigate(`${base}/ranking`)}>Compute Rankings</button>
            <button className="btn" onClick={() => navigate(`${base}/allocations`)}>Manage Allocations</button>
            <button className="btn" onClick={() => navigate(`${base}/intelligence`)}>AI Advisory</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  return (
    <article className={`metric-card ${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <span className="metric-label">{label}</span>
      <b className="metric-value">{value.toLocaleString()}</b>
    </article>
  );
}
