import { useEffect, useState } from 'react';
import { api } from '../../api';

type Cycle = { id: string; code: string; name: string; academicPeriod: string; status: string; startDate: string; endDate: string };

export function CyclesManagement() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', academicPeriod: '', startDate: '', endDate: '' });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get<Cycle[]>('/selection-cycles')
      .then((d) => setCycles(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/selection-cycles', form);
      setShowForm(false);
      setForm({ code: '', name: '', academicPeriod: '', startDate: '', endDate: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function updateStatus(id: string, status: string) {
    try {
      await api.patch(`/selection-cycles/${id}`, { status });
      setCycles((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  const nextStatus: Record<string, string> = { DRAFT: 'ACTIVE', ACTIVE: 'COMPLETED' };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMIN PORTAL</p>
          <h1>Selection Cycles</h1>
        </div>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'New Cycle'}</button>
      </header>

      {error && <div className="notice">{error}</div>}

      {showForm && (
        <section className="card">
          <h2>Create Cycle</h2>
          <form onSubmit={handleCreate} style={{ display: 'grid', gap: '0.75rem', maxWidth: '400px' }}>
            <label>Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="SC-2026-S2" /></label>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Academic Period<input value={form.academicPeriod} onChange={(e) => setForm({ ...form, academicPeriod: e.target.value })} required placeholder="2026-S2" /></label>
            <label>Start Date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
            <label>End Date<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></label>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
          </form>
        </section>
      )}

      {loading ? <p className="empty-state">Loading...</p> : (
        <section className="card">
          <table className="data-table">
            <thead><tr><th>Code</th><th>Name</th><th>Period</th><th>Status</th><th>Start</th><th>End</th><th></th></tr></thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id}>
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.academicPeriod}</td>
                  <td><span className="tag">{c.status}</span></td>
                  <td>{new Date(c.startDate).toLocaleDateString()}</td>
                  <td>{new Date(c.endDate).toLocaleDateString()}</td>
                  <td>
                    {nextStatus[c.status] && (
                      <button className="btn small" onClick={() => updateStatus(c.id, nextStatus[c.status])}>
                        {nextStatus[c.status] === 'ACTIVE' ? 'Activate' : 'Complete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
