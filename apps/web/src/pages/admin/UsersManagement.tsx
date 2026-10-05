import { useEffect, useState } from 'react';
import { api } from '../../api';

type User = { id: string; email: string; name: string; role: string; isActive: boolean; createdAt: string };
const ROLES = ['ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF', 'STUDENT'];

export function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'STUDENT', studentId: '' });
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get<User[]>('/admin/users')
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/admin/users', { ...form, studentId: form.studentId || undefined });
      setShowForm(false);
      setForm({ email: '', password: '', name: '', role: 'STUDENT', studentId: '' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function changeRole(id: string, role: string) {
    try {
      await api.patch(`/admin/users/${id}/role`, { role });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    try {
      await api.patch(`/admin/users/${id}/status`, { isActive });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive } : u)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMIN PORTAL</p>
          <h1>User Management</h1>
        </div>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Create User'}</button>
      </header>

      {error && <div className="notice">{error}</div>}

      {showForm && (
        <section className="card">
          <h2>New User</h2>
          <form onSubmit={handleCreate} style={{ display: 'grid', gap: '0.75rem', maxWidth: '400px' }}>
            <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
            <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>Student ID (optional)<input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} placeholder="Link to student record" /></label>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
          </form>
        </section>
      )}

      {loading ? <p className="empty-state">Loading...</p> : (
        <section className="card">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Created</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className={`btn small ${u.isActive ? '' : 'primary'}`} onClick={() => toggleActive(u.id, !u.isActive)}>
                      {u.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
