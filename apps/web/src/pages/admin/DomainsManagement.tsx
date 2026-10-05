import { useEffect, useState } from 'react';
import { api } from '../../api';

type Domain = { id: string; code: string; name: string; program?: { code: string; name: string }; _count?: { trainingBatches: number } };
type Program = { id: string; code: string; name: string };

export function DomainsManagement() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDomainForm, setShowDomainForm] = useState(false);
  const [showProgramForm, setShowProgramForm] = useState(false);
  const [domainForm, setDomainForm] = useState({ code: '', name: '', programId: '' });
  const [programForm, setProgramForm] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get<Domain[]>('/domains').then((d) => { if (Array.isArray(d)) setDomains(d); }),
      api.get<Program[]>('/domains/programs').then((d) => { if (Array.isArray(d)) setPrograms(d); }),
    ])
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function createDomain(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/domains', domainForm);
      setShowDomainForm(false);
      setDomainForm({ code: '', name: '', programId: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function createProgram(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/domains/programs', programForm);
      setShowProgramForm(false);
      setProgramForm({ code: '', name: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMIN PORTAL</p>
          <h1>Programs & Domains</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn" onClick={() => { setShowProgramForm(!showProgramForm); setShowDomainForm(false); }}>New Program</button>
          <button className="btn primary" onClick={() => { setShowDomainForm(!showDomainForm); setShowProgramForm(false); }}>New Domain</button>
        </div>
      </header>

      {error && <div className="notice">{error}</div>}

      {showProgramForm && (
        <section className="card">
          <h2>Create Program</h2>
          <form onSubmit={createProgram} style={{ display: 'grid', gap: '0.75rem', maxWidth: '400px' }}>
            <label>Code<input value={programForm.code} onChange={(e) => setProgramForm({ ...programForm, code: e.target.value })} required placeholder="PEP" /></label>
            <label>Name<input value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })} required /></label>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
          </form>
        </section>
      )}

      {showDomainForm && (
        <section className="card">
          <h2>Create Domain</h2>
          <form onSubmit={createDomain} style={{ display: 'grid', gap: '0.75rem', maxWidth: '400px' }}>
            <label>Code<input value={domainForm.code} onChange={(e) => setDomainForm({ ...domainForm, code: e.target.value })} required placeholder="PEPC-19" /></label>
            <label>Name<input value={domainForm.name} onChange={(e) => setDomainForm({ ...domainForm, name: e.target.value })} required /></label>
            <label>Program
              <select value={domainForm.programId} onChange={(e) => setDomainForm({ ...domainForm, programId: e.target.value })} required>
                <option value="">Select program...</option>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
          </form>
        </section>
      )}

      {loading ? <p className="empty-state">Loading...</p> : (
        <>
          <section className="card">
            <h2>Programs ({programs.length})</h2>
            <div className="tag-row">{programs.map((p) => <span key={p.id} className="tag">{p.code}: {p.name}</span>)}</div>
          </section>
          <section className="card">
            <h2>Domains ({domains.length})</h2>
            <table className="data-table">
              <thead><tr><th>Code</th><th>Name</th><th>Program</th></tr></thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <td>{d.code}</td>
                    <td>{d.name}</td>
                    <td>{d.program?.code ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
