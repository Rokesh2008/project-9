import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CycleSelector } from '../../components/CycleSelector';

type Allocation = {
  id: string;
  status: string;
  isFrozen: boolean;
  domain: { code: string; name: string } | null;
  trainingBatch: { batchCode: string; batchName: string } | null;
};

export function StudentAllocation() {
  const [cycleId, setCycleId] = useState('');
  const [alloc, setAlloc] = useState<Allocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    setError('');
    api.get<Allocation | null>(`/my/allocation/${cycleId}`)
      .then(setAlloc)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>My Allocation</h1>
        </div>
        <CycleSelector value={cycleId} onChange={setCycleId} />
      </header>

      {loading && <p className="empty-state">Loading...</p>}
      {error && <div className="notice">{error}</div>}

      {!loading && !error && !alloc && cycleId && (
        <section className="card">
          <p className="empty-state">No allocation has been made yet for this cycle. Please check back later.</p>
        </section>
      )}

      {alloc && (
        <section className="card">
          <h2>Allocation Details</h2>
          <table className="data-table">
            <tbody>
              <tr><td><strong>Domain</strong></td><td>{alloc.domain?.name ?? '—'} ({alloc.domain?.code ?? '—'})</td></tr>
              <tr><td><strong>Training Batch</strong></td><td>{alloc.trainingBatch?.batchName ?? '—'} ({alloc.trainingBatch?.batchCode ?? '—'})</td></tr>
              <tr><td><strong>Status</strong></td><td><span className="tag">{alloc.status}</span></td></tr>
              <tr><td><strong>Frozen</strong></td><td><span className={`tag ${alloc.isFrozen ? 'green' : 'neutral'}`}>{alloc.isFrozen ? 'Yes — Final' : 'No — Subject to change'}</span></td></tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
