import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../auth';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: 'D' },
  { to: '/admin/users', label: 'Users', icon: 'U' },
  { to: '/admin/students', label: 'Students', icon: 'S' },
  { to: '/admin/import', label: 'Import', icon: 'I' },
  { to: '/admin/cycles', label: 'Cycles', icon: 'Y' },
  { to: '/admin/domains', label: 'Domains', icon: 'M' },
  { to: '/admin/eligibility', label: 'Eligibility', icon: 'E' },
  { to: '/admin/scoring', label: 'Scoring', icon: 'W' },
  { to: '/admin/ranking', label: 'Ranking', icon: 'R' },
  { to: '/admin/classification', label: 'Classification', icon: 'C' },
  { to: '/admin/allocations', label: 'Allocations', icon: 'A' },
  { to: '/admin/intelligence', label: 'AI Advisory', icon: 'Q' },
  { to: '/admin/reports', label: 'Reports', icon: 'P' },
  { to: '/admin/audit', label: 'Audit Logs', icon: 'L' },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const user = getUser();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar admin-sidebar">
        <div className="sidebar-brand">
          <span className="logo">P9</span>
          <div>
            <strong>Admin Portal</strong>
            <small>Full Control</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div className="user-info">
              <small>ADMIN</small>
              <span>{user.name}</span>
              <button className="btn small" onClick={handleLogout}>Sign out</button>
            </div>
          )}
          <div className="guardrail-badge">
            <b>Advisory boundary</b>
            <p>AI recommends. Humans decide.</p>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
