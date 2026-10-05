import { useEffect, useState } from 'react';
import { api } from '../api';

type Log = {
  id: string;
  source: string;
  operation: string;
  method: string;
  status: string;
  recordCount: number;
  startedAt: string;
  endedAt?: string;
  error?: string;
};

export function Import() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function refresh() {
    try {
      const data = await api.get<Log[]>('/integrations/logs');
      if (Array.isArray(data)) setLogs(data);
    } catch (e: any) { setNotice(e.message ?? 'Failed to load import history'); }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api.upload<any>('/integrations/import/excel', fd);
      setNotice(result.duplicate ? 'Duplicate import (already processed)' : `Imported ${result.imported} records`);
      await refresh();
    } catch (e: any) {
      setNotice(e.message);
    }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">DATA INGESTION</p>
          <h1>Import</h1>
        </div>
        <button className="btn" onClick={() => void refresh()}>Refresh</button>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Upload Spreadsheet</h2>
        <p className="subtitle">CSV or XLSX files. Uses the same canonical DTO and validation as the API endpoints.</p>
        <div className="upload-area">
          <label className="btn primary upload-btn">
            {busy ? 'Importing...' : 'Choose CSV / XLSX'}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={busy}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              hidden
            />
          </label>
          <a className="btn" href="/api/integrations/templates/students.csv" download>
            Download Template
          </a>
        </div>
      </section>

      <section className="card">
        <h2>Integration Sources</h2>
        <div className="source-grid">
          <SourceCard code="P2" title="Project 2 — Readiness Data" desc="Student demographics and assessment scores" />
          <SourceCard code="P1" title="Project 1 — Communication" desc="Communication assessment results" />
          <SourceCard code="P8" title="Project 8 — Interview" desc="Interview attempt history" />
          <SourceCard code="XL" title="Manual Import" desc="CSV/XLSX through the canonical pipeline" />
        </div>
      </section>

      <section className="card">
        <h2>Import History</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Operation</th>
              <th>Method</th>
              <th>Records</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.source}</td>
                <td>{log.operation}</td>
                <td>{log.method}</td>
                <td>{log.recordCount}</td>
                <td><span className={`pill ${log.status.toLowerCase()}`}>{log.status}</span></td>
                <td>{new Date(log.endedAt ?? log.startedAt).toLocaleString()}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">No import jobs recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SourceCard({ code, title, desc }: { code: string; title: string; desc: string }) {
  return (
    <article className="source-card">
      <span className="source-code">{code}</span>
      <div>
        <b>{title}</b>
        <small>{desc}</small>
      </div>
    </article>
  );
}
