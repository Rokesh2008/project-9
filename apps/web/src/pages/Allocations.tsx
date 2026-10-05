import { useEffect, useState } from 'react';
import { api } from '../api';
import { getUser } from '../auth';
import { CycleSelector } from '../components/CycleSelector';

type Allocation = {
  id: string;
  studentId: string;
  status: string;
  preferenceRankUsed: number | null;
  isFinalized: boolean;
  isFrozen: boolean;
  failureReason: string | null;
  student: { name: string; studentId: string } | null;
  domain: { code: string; name: string } | null;
  trainingBatch: { batchCode: string } | null;
};

export function Allocations() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function refresh() {
    try {
      const url = cycleId ? `/allocations?selectionCycleId=${cycleId}` : '/allocations';
      const data = await api.get<Allocation[]>(url);
      if (Array.isArray(data)) setAllocations(data);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load allocations'); setAllocations([]); }
  }

  useEffect(() => { void refresh(); }, [cycleId]);

  async function generate() {
    if (!cycleId) { setNotice('Enter a selection cycle ID'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>('/allocations/generate', { selectionCycleId: cycleId });
      setNotice(`Processed ${res.totalProcessed}: ${res.allocated} allocated, ${res.manualReview ?? 0} manual review`);
      await refresh();
    } catch (e: any) { setNotice(e.message); }
    setBusy(false);
  }

  async function action(id: string, act: 'approve' | 'reject' | 'freeze') {
    setBusy(true);
    try {
      const user = getUser();
      const actorId = user?.id ?? 'unknown';
      const body = act === 'freeze'
        ? { actorId }
        : { actorId, reason: `${act}d by ${user?.name ?? 'admin'}` };
      await api.post(`/allocations/${id}/${act}`, body);
      setNotice(`Allocation ${act}d`);
      await refresh();
    } catch (e: any) { setNotice(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKFLOW STEP 7</p>
          <h1>Allocation Management</h1>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <div className="toolbar">
          <CycleSelector value={cycleId} onChange={setCycleId} />
          <button className="btn primary" disabled={busy} onClick={generate}>Generate Allocations</button>
          <button className="btn" onClick={() => void refresh()}>Refresh</button>
        </div>
      </section>

      <section className="card">
        <h2>Allocations</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Domain</th>
              <th>Pref #</th>
              <th>Status</th>
              <th>Batch</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id}>
                <td>
                  <div><b>{a.student?.name ?? '-'}</b></div>
                  <small>{a.student?.studentId}</small>
                </td>
                <td>{a.domain ? `${a.domain.code} ${a.domain.name}` : a.failureReason ?? '-'}</td>
                <td>{a.preferenceRankUsed ?? '-'}</td>
                <td><span className={`pill ${a.status.toLowerCase().replace('_', '-')}`}>{a.status}</span></td>
                <td>{a.trainingBatch?.batchCode ?? '-'}</td>
                <td>
                  <div className="btn-group">
                    {(a.status === 'PENDING_APPROVAL' || a.status === 'MANUAL_REVIEW') && (
                      <>
                        <button className="btn small success" disabled={busy} onClick={() => action(a.id, 'approve')}>Approve</button>
                        <button className="btn small danger" disabled={busy} onClick={() => action(a.id, 'reject')}>Reject</button>
                      </>
                    )}
                    {a.status === 'APPROVED' && !a.isFrozen && (
                      <button className="btn small" disabled={busy} onClick={() => action(a.id, 'freeze')}>Freeze</button>
                    )}
                    {a.isFrozen && <span className="pill frozen">LOCKED</span>}
                  </div>
                </td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No allocations. Enter a cycle ID and generate.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="workflow-hint">
        <b>Workflow:</b> Generate &rarr; Pending Approval &rarr; Approve &rarr; Freeze (immutable) | Reject
      </div>
    </div>
  );
}
