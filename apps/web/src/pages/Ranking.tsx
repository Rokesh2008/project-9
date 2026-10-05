import { useState } from 'react';
import { api } from '../api';
import { CycleSelector } from '../components/CycleSelector';

export function Ranking() {
  const [cycleId, setCycleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [rankings, setRankings] = useState<any[]>([]);

  async function computeRanking() {
    if (!cycleId) { setNotice('Enter a cycle ID'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>('/ranking/calculate', { selectionCycleId: cycleId });
      setNotice(`Ranked ${res.ranked ?? 0} students`);
      await loadRankings();
    } catch (e: any) {
      setNotice(e.message);
    }
    setBusy(false);
  }

  async function loadRankings() {
    if (!cycleId) return;
    try {
      const data = await api.get<any>(`/ranking/${cycleId}`);
      setRankings(Array.isArray(data) ? data : data?.data ?? []);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load rankings'); setRankings([]); }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKFLOW STEP 4</p>
          <h1>Ranking</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Compute Rankings</h2>
        <p className="subtitle">Rank eligible students by their composite scores within the selection cycle.</p>
        <div className="toolbar">
          <CycleSelector value={cycleId} onChange={setCycleId} />
          <button className="btn" onClick={() => void loadRankings()}>Load</button>
          <button className="btn primary" disabled={busy} onClick={computeRanking}>Compute Ranking</button>
        </div>
      </section>

      {rankings.length > 0 && (
        <section className="card">
          <h2>Current Rankings</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Student ID</th>
                <th>Percentile</th>
                <th>Calculated At</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td>{r.rank ?? i + 1}</td>
                  <td>{r.studentId}</td>
                  <td>{r.percentile != null ? `${r.percentile}%` : '-'}</td>
                  <td>{r.calculatedAt ? new Date(r.calculatedAt).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
