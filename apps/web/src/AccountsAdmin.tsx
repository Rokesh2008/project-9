import React, { useEffect, useMemo, useState } from 'react';
import { API, apiFetch } from './api';
import './portals.css';

type Role = 'ADMIN' | 'COORDINATOR' | 'PEP_STAFF' | 'STUDENT';
type Account = {
  id: string; name: string; email: string; role: Role; isActive: boolean;
  student: { studentId: string; name: string } | null;
  facultyDomain: { code: string; name: string } | null;
};
type Form = { name: string; email: string; role: Role; password: string; studentId: string; facultyDomainCode: string; isActive: boolean };
const empty: Form = { name: '', email: '', role: 'STUDENT', password: '', studentId: '', facultyDomainCode: '', isActive: true };

export function AccountsAdmin() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [students, setStudents] = useState<Array<{ studentId: string; name: string }>>([]);
  const [domains, setDomains] = useState<Array<{ code: string; name: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const matches=useMemo(()=>accounts.filter(a=>`${a.name} ${a.email} ${a.role} ${a.student?.studentId??''} ${a.facultyDomain?.name??''}`.toLowerCase().includes(search.toLowerCase())),[accounts,search]);
  const pages=Math.max(1,Math.ceil(matches.length/50));
  const safePage=Math.min(page,pages);
  const visibleAccounts=matches.slice((safePage-1)*50,safePage*50);
  const studentOptions=useMemo(()=>students.filter(s=>`${s.studentId} ${s.name}`.toLowerCase().includes(form.studentId.toLowerCase())).slice(0,50),[students,form.studentId]);

  async function read<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(`${API}${path}`, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? `Request failed (${response.status})`);
    return body as T;
  }

  async function refresh() {
    try {
      const [users, options] = await Promise.all([
        read<Account[]>('/accounts'),
        read<{ students: Array<{ studentId: string; name: string }>; domains: Array<{ code: string; name: string }> }>('/accounts/options'),
      ]);
      setAccounts(users);
      setStudents(options.students);
      setDomains(options.domains);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not load accounts'); }
  }
  useEffect(() => { void refresh(); }, []);

  function edit(account: Account) {
    setSelectedId(account.id);
    setForm({
      name: account.name, email: account.email, role: account.role, password: '',
      studentId: account.student?.studentId ?? '', facultyDomainCode: account.facultyDomain?.code ?? '',
      isActive: account.isActive,
    });
    setNotice('');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(), email: form.email.trim(), role: form.role,
        ...(selectedId ? { isActive: form.isActive } : {}),
        ...(form.password ? { password: form.password } : {}),
        ...(form.role === 'STUDENT' ? { studentId: form.studentId } : {}),
        ...(form.role === 'PEP_STAFF' ? { facultyDomainCode: form.facultyDomainCode } : {}),
      };
      await read(selectedId ? `/accounts/${selectedId}` : '/accounts', {
        method: selectedId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      setNotice(selectedId ? 'Account updated. Role and activation changes take effect on the next request.' : 'Account created. Share the temporary password securely with its owner.');
      setForm(empty); setSelectedId(null);
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not save account'); }
    finally { setBusy(false); }
  }

  return <div className="portalShell">
    <header className="portalHeader"><div><p className="portalEyebrow">ADMINISTRATOR ONLY</p><h1>Account management</h1><p>Create student and faculty logins, assign a single faculty domain, reset passwords, and disable accounts.</p></div><button onClick={() => void refresh()}>Refresh</button></header>
    {notice ? <p className="portalNotice">{notice}</p> : null}
    <section className="portalCard">
      <h2>{selectedId ? 'Edit account' : 'Create account'}</h2>
      <form className="accountForm" onSubmit={(event) => void save(event)}>
        <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role, studentId: '', facultyDomainCode: '' })}><option value="STUDENT">Student</option><option value="PEP_STAFF">Faculty / PEP staff</option><option value="COORDINATOR">Coordinator</option><option value="ADMIN">Administrator</option></select></label>
        {form.role === 'STUDENT' ? <label>Student ID<input required list="account-students" placeholder="Type to search all imported students" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} /><datalist id="account-students">{studentOptions.map((s) => <option value={s.studentId} label={s.name} key={s.studentId} />)}</datalist></label> : null}
        {form.role === 'PEP_STAFF' ? <label>Assigned domain<select required value={form.facultyDomainCode} onChange={(e) => setForm({ ...form, facultyDomainCode: e.target.value })}><option value="">Select a domain</option>{domains.map((d) => <option value={d.code} key={d.code}>{d.code} · {d.name}</option>)}</select></label> : null}
        <label>{selectedId ? 'New password (leave blank to keep current)' : 'Temporary password (12+ characters)'}<input type="password" minLength={12} required={!selectedId} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {selectedId ? <label className="checkLabel"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Account active</label> : null}
        <div className="portalActions"><button disabled={busy} type="submit">{busy ? 'Saving…' : selectedId ? 'Save changes' : 'Create account'}</button>{selectedId ? <button type="button" onClick={() => { setSelectedId(null); setForm(empty); }}>Cancel edit</button> : null}</div>
      </form>
    </section>
    <section className="portalCard"><h2>Accounts ({accounts.length})</h2><label>Search accounts<input value={search} placeholder="Name, email, student ID, role or domain" onChange={e=>{setSearch(e.target.value);setPage(1);}} /></label><div className="accountList">{visibleAccounts.map((a) => <div className="queueRow" key={a.id}><div><b>{a.name}</b><p>{a.email} · {a.role.replaceAll('_', ' ')} · {a.isActive ? 'Active' : 'Disabled'}</p><small>{a.student ? `Student ${a.student.studentId}` : a.facultyDomain ? `Domain ${a.facultyDomain.code} ${a.facultyDomain.name}` : 'All-domain staff'}</small></div><button onClick={() => edit(a)}>Manage</button></div>)}</div><div className="directoryPages"><button disabled={safePage<=1} onClick={()=>setPage(safePage-1)}>Previous accounts</button><span>Page {safePage} of {pages} · {matches.length} matching accounts · 50 per page</span><button disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}>Next accounts</button></div></section>
  </div>;
}
