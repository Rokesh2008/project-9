import { useEffect, useState } from 'react';
import { api } from '../../api';

type AuditEntry = { id: string; action: string; actor: string; entityType?: string; entityId?: string; details?: unknown; createdAt: string };

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.get<AuditEntry[]>('/audit')
      .then((d) => setLogs(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMIN PORTAL</p>
          <h1>Audit Logs</h1>
        </div>
        <button className="btn" onClick={load}>Refresh</button>
      </header>

      {error && <div className="notice">{error}</div>}

      {loading ? <p className="empty-state">Loading...</p> : logs.length === 0 ? <p className="empty-state">No audit entries.</p> : (
        <section className="card">
          <table className="data-table">
            <thead><tr><th>Timestamp</th><th>Action</th><th>Actor</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.createdAt).toLocaleString()}</td>
                  <td><span className="tag">{l.action}</span></td>
                  <td>{l.actor}</td>
                  <td>{l.entityType ? `${l.entityType}:${l.entityId ?? ''}` : '—'}</td>
                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.details ? JSON.stringify(l.details) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
