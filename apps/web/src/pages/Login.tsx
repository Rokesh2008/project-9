import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setUser } from '../auth';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

const ROLE_HOME: Record<string, string> = {
  STUDENT: '/student',
  ADMIN: '/admin',
  PLACEMENT_COORDINATOR: '/staff',
  COORDINATOR: '/staff',
  PEP_STAFF: '/staff',
};

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Login failed');
      sessionStorage.setItem('token', data.accessToken);
      if (data.user) {
        setUser(data.user);
      }
      const role = data.user?.role ?? '';
      navigate(ROLE_HOME[role] ?? '/');
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <div className="login-brand">
          <span className="logo">P9</span>
          <h1>Selection OS</h1>
          <p>Student Allocation Management</p>
        </div>
        {error && <div className="login-error">{error}</div>}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary full" type="submit" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
