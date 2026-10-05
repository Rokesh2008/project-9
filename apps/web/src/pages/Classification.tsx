import { useState } from 'react';
import { api } from '../api';
import { CycleSelector } from '../components/CycleSelector';

export function Classification() {
  const [cycleId, setCycleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<any[]>([]);

  async function runClassification() {
    if (!cycleId) { setNotice('Enter a cycle ID'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>('/classification/calculate', { selectionCycleId: cycleId });
      setNotice(`Classified ${res.classified ?? 0} students: ${res.hope ?? 0} HOPE, ${res.pep ?? 0} PEP`);
      await loadResults();
    } catch (e: any) {
      setNotice(e.message);
    }
    setBusy(false);
  }

  async function loadResults() {
    if (!cycleId) return;
    try {
      const data = await api.get<any>(`/classification/${cycleId}`);
      setResults(Array.isArray(data) ? data : data?.data ?? []);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load classifications'); setResults([]); }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKFLOW STEP 5</p>
          <h1>HOPE/PEP Classification</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Classify Students</h2>
        <p className="subtitle">Classify ranked students into HOPE or PEP programs based on cycle configuration thresholds.</p>
        <div className="toolbar">
          <CycleSelector value={cycleId} onChange={setCycleId} />
          <button className="btn" onClick={() => void loadResults()}>Load</button>
          <button className="btn primary" disabled={busy} onClick={runClassification}>Classify</button>
        </div>
      </section>

      {results.length > 0 && (
        <section className="card">
          <h2>Classification Results</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Program</th>
                <th>Classified At</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.id ?? i}>
                  <td>{r.studentId}</td>
                  <td><span className={`pill ${r.program === 'PEP' ? 'succeeded' : 'pending'}`}>{r.program}</span></td>
                  <td>{r.classifiedAt ? new Date(r.classifiedAt).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
