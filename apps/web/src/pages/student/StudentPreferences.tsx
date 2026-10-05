import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CycleSelector } from '../../components/CycleSelector';

type Preference = { id: string; preferenceRank: number; domainId: string; domain: { id: string; code: string; name: string } };
type Domain = { id: string; code: string; name: string };

export function StudentPreferences() {
  const [cycleId, setCycleId] = useState('');
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<Array<{ domainId: string; name: string }>>([]);

  useEffect(() => {
    api.get<Domain[]>('/domains').then((d) => { if (Array.isArray(d)) setDomains(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    setError('');
    setSuccess('');
    api.get<Preference[]>(`/my/preferences/${cycleId}`)
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setPrefs(list);
        setDraft(list.map((p) => ({ domainId: p.domainId, name: p.domain?.name ?? p.domainId })));
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  function addDomain(domainId: string) {
    if (draft.find((d) => d.domainId === domainId)) return;
    const dom = domains.find((d) => d.id === domainId);
    if (dom) setDraft([...draft, { domainId: dom.id, name: dom.name }]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...draft];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setDraft(next);
  }

  function moveDown(index: number) {
    if (index === draft.length - 1) return;
    const next = [...draft];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setDraft(next);
  }

  function remove(index: number) {
    setDraft(draft.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!cycleId || draft.length === 0) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const preferences = draft.map((d, i) => ({ domainId: d.domainId, rank: i + 1 }));
      await api.post(`/my/preferences/${cycleId}`, { preferences });
      setSuccess('Preferences saved successfully.');
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  const available = domains.filter((d) => !draft.find((p) => p.domainId === d.id));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>Domain Preferences</h1>
        </div>
        <CycleSelector value={cycleId} onChange={setCycleId} />
      </header>

      {loading && <p className="empty-state">Loading...</p>}
      {error && <div className="notice">{error}</div>}
      {success && <div className="notice" style={{ background: 'var(--green-bg, #e6f9e6)' }}>{success}</div>}

      {!loading && cycleId && (
        <div className="two-col">
          <section className="card">
            <h2>Your Ranked Preferences</h2>
            {draft.length === 0 ? (
              <p className="empty-state">No preferences selected. Add domains from the list.</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>Rank</th><th>Domain</th><th>Actions</th></tr></thead>
                <tbody>
                  {draft.map((d, i) => (
                    <tr key={d.domainId}>
                      <td>{i + 1}</td>
                      <td>{d.name}</td>
                      <td>
                        <button className="btn small" onClick={() => moveUp(i)} disabled={i === 0}>Up</button>{' '}
                        <button className="btn small" onClick={() => moveDown(i)} disabled={i === draft.length - 1}>Down</button>{' '}
                        <button className="btn small" onClick={() => remove(i)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn primary" onClick={handleSave} disabled={saving || draft.length === 0} style={{ marginTop: '1rem' }}>
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </section>

          <section className="card">
            <h2>Available Domains</h2>
            {available.length === 0 ? (
              <p className="empty-state">All domains selected.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {available.map((d) => (
                  <button key={d.id} className="btn" onClick={() => addDomain(d.id)}>{d.code} — {d.name}</button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
