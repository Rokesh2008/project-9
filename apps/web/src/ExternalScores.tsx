import React, { useState } from 'react';
import { API, apiFetch } from './api';
export function ExternalScores({ onSynced }: { onSynced: () => Promise<void> }) {
  const [source, setSource] = useState('ALL'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<any[]>([]);
  async function run(dryRun: boolean) {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`${API}/external-scores/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, dryRun }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Score fetch failed');
      setResults(data.summaries); if (!dryRun) await onSynced();
    } catch (e) { setError(e instanceof Error ? e.message : 'Score fetch failed'); }
    finally { setBusy(false); }
  }
  return <section className="portalCard"><h3>Fetch external scores</h3><p className="portalMuted">Fetch SpeakReady, 12-parameter and AI Interviewer scores. Selection and allocations remain unchanged.</p>
    <div className="exports"><select aria-label="Score source" disabled={busy} value={source} onChange={e => setSource(e.target.value)}><option value="ALL">All sources</option><option value="SPEAKREADY">SpeakReady</option><option value="READINESS">12 parameters</option><option value="INTERVIEW">AI Interviewer</option></select><button disabled={busy} onClick={() => void run(true)}>Preview matches</button><button disabled={busy} onClick={() => void run(false)}>{busy ? 'Fetching…' : 'Fetch scores'}</button></div>
    {error && <p role="alert" className="portalError">{error}</p>}
    <div className="tableScroll"><table><thead><tr><th>Source</th><th>Status</th><th>Fetched</th><th>Matched</th><th>New</th><th>Duplicates</th><th>Skipped</th></tr></thead><tbody>{results.map((r, i) => <tr key={`${r.source}-${i}`}><td>{r.source}</td><td>{r.dryRun ? 'PREVIEW · ' : ''}{r.status}{r.error && <small>{r.error}</small>}</td><td>{r.fetched}</td><td>{r.matched}</td><td>{r.inserted}</td><td>{r.duplicates}</td><td>{Object.entries(r.skipped).map(([key, count]) => `${key}: ${count}`).join(', ') || 'None'}</td></tr>)}</tbody></table></div>
    <p className="portalMuted">Matches use register/college roll numbers. Unmatched, ambiguous, incomplete or flagged records are skipped. Unchanged scores are not duplicated. Readiness scores require upstream verification.</p>
  </section>;
}
