import { useEffect, useState } from 'react';
import { api } from '../api';
import { CycleSelector } from '../components/CycleSelector';

type WeightVersion = {
  id: string;
  selectionCycleId: string;
  description?: string;
  isActive: boolean;
  weights: Record<string, number>;
  createdAt: string;
};

export function Scoring() {
  const [cycleId, setCycleId] = useState('');
  const [versions, setVersions] = useState<WeightVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function loadVersions() {
    if (!cycleId) return;
    try {
      const data = await api.get<WeightVersion[]>(`/weights/${cycleId}/versions`);
      if (Array.isArray(data)) setVersions(data);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load weight versions'); setVersions([]); }
  }

  async function runScoring() {
    if (!cycleId) { setNotice('Enter a cycle ID'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>('/scoring/calculate-batch', { selectionCycleId: cycleId });
      setNotice(`Scored ${res.scored ?? 0} students`);
    } catch (e: any) {
      setNotice(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKFLOW STEP 3</p>
          <h1>Scoring & Weights</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Weight Configuration</h2>
        <p className="subtitle">Configure scoring weights for the selection cycle, then compute composite scores.</p>
        <div className="toolbar">
          <CycleSelector value={cycleId} onChange={setCycleId} />
          <button className="btn" onClick={() => void loadVersions()}>Load Versions</button>
          <button className="btn primary" disabled={busy} onClick={runScoring}>Compute Scores</button>
        </div>
      </section>

      {versions.length > 0 && (
        <section className="card">
          <h2>Weight Versions</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Description</th>
                <th>Parameters</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v: any) => (
                <tr key={v.id}>
                  <td>v{v.version}</td>
                  <td>{v.description ?? v.id}</td>
                  <td>{v.parameterCount ?? '-'}</td>
                  <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
