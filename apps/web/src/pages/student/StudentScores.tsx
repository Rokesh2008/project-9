import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CycleSelector } from '../../components/CycleSelector';

type Score = {
  id: string;
  parameterKey: string;
  rawScore: number;
  normalizedScore: number;
  weightedScore: number;
  weight: number;
};

export function StudentScores() {
  const [cycleId, setCycleId] = useState('');
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    setError('');
    api.get<Score[]>(`/my/scores/${cycleId}`)
      .then((d) => setScores(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  const total = scores.reduce((s, r) => s + (r.weightedScore ?? 0), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>My Scores</h1>
        </div>
        <CycleSelector value={cycleId} onChange={setCycleId} />
      </header>

      {loading && <p className="empty-state">Loading...</p>}
      {error && <div className="notice">{error}</div>}

      {!loading && !error && scores.length === 0 && cycleId && (
        <p className="empty-state">No scores computed yet for this cycle.</p>
      )}

      {scores.length > 0 && (
        <section className="card">
          <table className="data-table">
            <thead>
              <tr><th>Parameter</th><th>Raw</th><th>Normalized</th><th>Weight</th><th>Weighted</th></tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id}>
                  <td>{s.parameterKey}</td>
                  <td>{s.rawScore?.toFixed(2)}</td>
                  <td>{s.normalizedScore?.toFixed(4)}</td>
                  <td>{s.weight?.toFixed(2)}</td>
                  <td>{s.weightedScore?.toFixed(4)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={4}>Total Weighted Score</td>
                <td>{total.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
