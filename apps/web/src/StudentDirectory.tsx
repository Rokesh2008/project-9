import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import { Icon } from './WorkspaceShell';

type Student = { studentId: string; name: string; registerNumber: string | null; rollNumber: string | null; department: string; departmentName: string; batch: string; readinessScore: number | null; verificationStatus: string; trainingGroup: string | null; allocationStatus: string };
type Directory = { total: number; page: number; pageSize: number; students: Student[] };

export function StudentDirectory({ onOpenProfile, onTotal, id = 'student-directory' }: { onOpenProfile: (studentId: string) => void; onTotal?: (total: number) => void; id?: string }) {
  const [data, setData] = useState<Directory | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ q: search, page: String(page), sort });
    void apiFetch(`${API}/profiles?${params}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Could not load students'); return body as Directory; })
      .then(body => { if (!controller.signal.aborted) { setData(body); if (!search) onTotal?.(body.total); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, page, sort, version, onTotal]);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  return <section className="portalCard rosterDirectory" id={id}>
    <div className="panelHead"><div><p className="eyebrow">ALL STUDENT RECORDS</p><h2><Icon name="users" />Student Directory</h2><p className="portalMuted">All active students, regardless of source or selection-cycle enrollment. Open a profile for all 12 parameter scores, selection progress and training details.</p></div><span className="outlineBadge">{data?.total ?? '—'} {search ? 'matching' : 'active'} students</span></div>
    <div className="ledgerToolbar"><form className="searchField" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}><Icon name="search" /><input aria-label="Search student directory" placeholder="Name, roll number, register number or student ID" value={query} onChange={event => setQuery(event.target.value)} /><button type="submit">Search</button><button type="button" className="ghost" onClick={() => { setQuery(''); setSearch(''); setPage(1); }}>Clear</button></form><button className="ghost" onClick={() => setVersion(v => v + 1)} disabled={loading}>Refresh directory</button></div>
    <label>Sort by readiness score <select aria-label="Sort by readiness score" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="">Student ID (default)</option><option value="readiness_desc">Highest score first (descending)</option><option value="readiness_asc">Lowest score first (ascending)</option></select></label>
    <p className="portalMuted">Sorting applies to all matching students. Students without a readiness score appear last.</p>
    {error && <p role="alert" className="portalError">{error}</p>}
    {loading ? <p role="status">Loading students…</p> : data && <><div className="tableScroll"><table><thead><tr><th>Student</th><th>Roll number</th><th>Register number</th><th>Department / Batch</th><th>Readiness</th><th>Training allocation</th></tr></thead><tbody>{data.students.map(student => <tr key={student.studentId}><td><button className="textButton" onClick={() => onOpenProfile(student.studentId)}>{student.name}</button><small className="tableMeta">{student.studentId}</small></td><td>{student.rollNumber ?? 'Pending mapping'}</td><td>{student.registerNumber ?? 'Not supplied'}</td><td>{student.departmentName ?? student.department}<small className="tableMeta">{student.batch}</small></td><td>{student.readinessScore == null ? 'Pending' : `${student.readinessScore} / 250`}<small className="tableMeta">{student.verificationStatus}</small></td><td>{student.trainingGroup ?? 'Not allocated'}<small className="tableMeta">{student.allocationStatus?.replaceAll('_', ' ')}</small></td></tr>)}</tbody></table></div>{!data.students.length && <p>No matching students.</p>}<div className="directoryPages"><button className="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {data.page} of {pages} · {data.total} students · {data.pageSize} per page</span><button className="ghost" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div></>}
  </section>;
}
