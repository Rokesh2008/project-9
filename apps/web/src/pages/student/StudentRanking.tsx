import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CycleSelector } from '../../components/CycleSelector';

type RankingData = {
  ranking: { rank: number; percentile: number; compositeScore: number; calculatedAt: string } | null;
  totalRanked: number;
};

export function StudentRanking() {
  const [cycleId, setCycleId] = useState('');
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    setError('');
    api.get<RankingData>(`/my/ranking/${cycleId}`)
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>My Ranking</h1>
        </div>
        <CycleSelector value={cycleId} onChange={setCycleId} />
      </header>

      {loading && <p className="empty-state">Loading...</p>}
      {error && <div className="notice">{error}</div>}

      {!loading && !error && data && !data.ranking && cycleId && (
        <p className="empty-state">Rankings have not been calculated yet for this cycle.</p>
      )}

      {data?.ranking && (
        <section className="card">
          <div className="metrics-grid" style={{ marginBottom: '1.5rem' }}>
            <article className="metric-card violet">
              <span className="metric-label">Rank</span>
              <b className="metric-value">#{data.ranking.rank}</b>
            </article>
            <article className="metric-card blue">
              <span className="metric-label">Percentile</span>
              <b className="metric-value">{data.ranking.percentile?.toFixed(1)}%</b>
            </article>
            <article className="metric-card cyan">
              <span className="metric-label">Composite Score</span>
              <b className="metric-value">{data.ranking.compositeScore?.toFixed(4)}</b>
            </article>
            <article className="metric-card neutral">
              <span className="metric-label">Total Ranked</span>
              <b className="metric-value">{data.totalRanked}</b>
            </article>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <label>Percentile Position</label>
            <div className="bar-track" style={{ height: '24px', borderRadius: '12px', marginTop: '0.5rem' }}>
              <div className="bar-fill" style={{ width: `${data.ranking.percentile}%`, borderRadius: '12px', background: 'var(--accent)' }} />
            </div>
            <small>Calculated: {new Date(data.ranking.calculatedAt).toLocaleString()}</small>
          </div>
        </section>
      )}
    </div>
  );
}
