import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';

type Allocation = {
  id: string;
  studentId: string;
  selectionCycleId: string;
  domainId: string | null;
  status: string;
  preferenceRankUsed: number | null;
  isFinalized: boolean;
  isFrozen: boolean;
  frozenAt: string | null;
  failureReason: string | null;
  createdAt: string;
  student: { name: string; studentId: string; email: string };
  domain: { code: string; name: string } | null;
  trainingBatch: { batchCode: string; batchName: string } | null;
};

export function AllocationAdmin({ initialCycleId = '' }: { initialCycleId?: string }) {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [cycleId, setCycleId] = useState(initialCycleId);

  async function refresh() {
    try {
      const url = cycleId ? `${API}/allocations?selectionCycleId=${cycleId}` : `${API}/allocations`;
      const res = await apiFetch(url);
      if (res.ok) setAllocations(await res.json());
    } catch {
      setNotice('Could not fetch allocations');
    }
  }

  useEffect(() => { void refresh(); }, [cycleId]);

  async function generate() {
    if (!cycleId) { setNotice('Enter a selection cycle ID first'); return; }
    setBusy(true);
    const res = await apiFetch(`${API}/allocations/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'admin-ui' },
      body: JSON.stringify({ selectionCycleId: cycleId }),
    });
    const data = await res.json();
    setNotice(res.ok
      ? `Processed ${data.totalProcessed}: ${data.allocated} allocated, ${data.manualReview} manual review, ${data.skipped} skipped`
      : data.message ?? 'Generation failed');
    setBusy(false);
    await refresh();
  }

  async function action(id: string, act: 'approve' | 'reject' | 'freeze') {
    setBusy(true);
    const body = act === 'freeze'
      ? { actorId: 'admin-ui' }
      : { actorId: 'admin-ui', reason: act === 'approve' ? 'Approved by admin' : 'Rejected by admin' };
    const res = await apiFetch(`${API}/allocations/${id}/${act}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'ADMIN', 'x-actor-id': 'admin-ui' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setNotice(res.ok ? `Allocation ${act}d successfully` : data.message ?? `${act} failed`);
    setBusy(false);
    await refresh();
  }

  const statusColor: Record<string, string> = {
    PENDING_APPROVAL: '#f59e0b',
    APPROVED: '#10b981',
    REJECTED: '#ef4444',
    FROZEN: '#6366f1',
    MANUAL_REVIEW: '#f97316',
  };

  return (
    <div className="allocationWorkspace">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Allocation Management</h1>
      <p style={{ color: '#64748b', marginBottom: 24, fontSize: 14 }}>Review training placements, approve allocations, and lock finalized records.</p>

      {notice && (
        <div style={{ padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {notice}
          <button onClick={() => setNotice('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center' }}>
        <input
          placeholder="Selection Cycle ID"
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, width: 320 }}
        />
        <button
          disabled={busy}
          onClick={generate}
          style={{ padding: '8px 20px', background: 'var(--college-red)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
        >
          Generate Allocations
        </button>
        <button
          onClick={() => void refresh()}
          style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
        >
          Refresh
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
            <th style={{ padding: '10px 12px' }}>Student</th>
            <th style={{ padding: '10px 12px' }}>Domain</th>
            <th style={{ padding: '10px 12px' }}>Pref #</th>
            <th style={{ padding: '10px 12px' }}>Status</th>
            <th style={{ padding: '10px 12px' }}>Batch</th>
            <th style={{ padding: '10px 12px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {allocations.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: 600 }}>{a.student?.name ?? '—'}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{a.student?.studentId}</div>
              </td>
              <td style={{ padding: '10px 12px' }}>
                {a.domain ? `${a.domain.code} ${a.domain.name}` : a.failureReason ?? '—'}
              </td>
              <td style={{ padding: '10px 12px' }}>{a.preferenceRankUsed ?? '—'}</td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: `${statusColor[a.status] ?? '#94a3b8'}20`, color: statusColor[a.status] ?? '#94a3b8',
                }}>
                  {a.status}
                </span>
              </td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>{a.trainingBatch?.batchCode ?? '—'}</td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(a.status === 'PENDING_APPROVAL' || a.status === 'MANUAL_REVIEW') && (
                    <>
                      <button disabled={busy} onClick={() => void action(a.id, 'approve')}
                        style={{ padding: '4px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                        Approve
                      </button>
                      <button disabled={busy} onClick={() => void action(a.id, 'reject')}
                        style={{ padding: '4px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                        Reject
                      </button>
                    </>
                  )}
                  {a.status === 'APPROVED' && !a.isFrozen && (
                    <button disabled={busy} onClick={() => void action(a.id, 'freeze')}
                      style={{ padding: '4px 12px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                      Freeze
                    </button>
                  )}
                  {a.isFrozen && <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>LOCKED</span>}
                </div>
              </td>
            </tr>
          ))}
          {allocations.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                No allocations found. Enter a cycle ID and click Generate.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 24, padding: 16, background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#64748b' }}>
        <strong>Workflow:</strong> Generate → Pending Approval → Approve → Freeze (immutable) | Reject
      </div>
    </div>
  );
}
