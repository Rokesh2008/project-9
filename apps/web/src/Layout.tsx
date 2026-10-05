import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from './auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'H' },
  { to: '/import', label: 'Import', icon: 'I' },
  { to: '/students', label: 'Students', icon: 'S' },
  { to: '/eligibility', label: 'Eligibility', icon: 'E' },
  { to: '/scoring', label: 'Scoring', icon: 'W' },
  { to: '/ranking', label: 'Ranking', icon: 'R' },
  { to: '/classification', label: 'Classification', icon: 'C' },
  { to: '/allocations', label: 'Allocations', icon: 'A' },
  { to: '/intelligence', label: 'AI Advisory', icon: 'Q' },
  { to: '/reports', label: 'Reports', icon: 'P' },
];

export function Layout() {
  const navigate = useNavigate();
  const user = getUser();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo">P9</span>
          <div>
            <strong>Selection OS</strong>
            <small>Student Allocation</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
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
              <small>{user.role}</small>
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
