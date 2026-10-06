import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import { Icon } from './WorkspaceShell';

type Directory = {
  total: number; page: number; pageSize: number; groups: Array<{ name: string; count: number }>;
  records: Array<{ studentId: string; registerNumber: string; name: string; department: string;
    academicBatch: string; trainingGroup: string; trainingLevel: string | null; sourceFile: string }>;
};

export function RosterAllocations({ onOpenProfile }: { onOpenProfile: (studentId: string) => void }) {
  const [data, setData] = useState<Directory | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ q: search, group, page: String(page) });
    void apiFetch(`${API}/profiles/roster-allocations?${params}`)
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Could not load allocations'); return body as Directory; })
      .then(body => { if (live) setData(body); })
      .catch(cause => { if (live) setError(cause.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [search, group, page]);
  return <section className="portalCard rosterDirectory" id="roster-allocations">
    <div className="panelHead"><div><p className="eyebrow">SECOND-YEAR TRAINING</p><h2><Icon name="users" />Excel Allocations</h2><p className="portalMuted">Existing college assignments, imported by register number. Assessment scores and new selection evaluations remain pending.</p></div><span className="outlineBadge">{data?.groups.reduce((sum, item) => sum + item.count, 0) ?? '—'} allocated students</span></div>
    <div className="ledgerToolbar">
      <form className="searchField" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query); }}><Icon name="search" /><input aria-label="Search imported allocations" placeholder="Student name or register number" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit">Search</button></form>
      <select aria-label="Filter training group" value={group} onChange={event => { setGroup(event.target.value); setPage(1); }}><option value="">All training groups</option>{data?.groups.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select>
    </div>
    {error && <p role="alert" className="portalError">{error}</p>}
    {loading ? <p role="status">Loading imported allocations…</p> : data && <><div className="tableScroll"><table><thead><tr><th>Student</th><th>Department / College</th><th>Training allocation</th><th>Training level</th><th>Source</th></tr></thead><tbody>{data.records.map(record => <tr key={record.studentId}><td><button className="textButton" onClick={() => onOpenProfile(record.studentId)}>{record.name}</button><small className="tableMeta">{record.registerNumber}</small></td><td>{record.department}<small className="tableMeta">{record.academicBatch.startsWith('SJCT-') ? 'St. Joseph’s Institute of Technology' : 'St. Joseph’s College of Engineering'}</small></td><td><b>{record.trainingGroup}</b></td><td>{record.trainingLevel ?? 'Not provided'}</td><td><span className="outlineBadge">Imported from Excel</span><small className="tableMeta">{record.sourceFile}</small></td></tr>)}</tbody></table></div>{!data.records.length && <p>No matching allocations.</p>}<div className="directoryPages"><button className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · {data.total} matching students</span><button className="ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</button></div></>}
  </section>;
}
