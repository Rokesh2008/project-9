import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../auth';

const NAV = [
  { to: '/staff', label: 'Dashboard', icon: 'D' },
  { to: '/staff/students', label: 'Students', icon: 'S' },
  { to: '/staff/import', label: 'Import', icon: 'I' },
  { to: '/staff/eligibility', label: 'Eligibility', icon: 'E' },
  { to: '/staff/scoring', label: 'Scoring', icon: 'W' },
  { to: '/staff/ranking', label: 'Ranking', icon: 'R' },
  { to: '/staff/classification', label: 'Classification', icon: 'C' },
  { to: '/staff/allocations', label: 'Allocations', icon: 'A' },
  { to: '/staff/intelligence', label: 'AI Advisory', icon: 'Q' },
  { to: '/staff/reports', label: 'Reports', icon: 'P' },
];

export function StaffLayout() {
  const navigate = useNavigate();
  const user = getUser();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar staff-sidebar">
        <div className="sidebar-brand">
          <span className="logo">P9</span>
          <div>
            <strong>Staff Portal</strong>
            <small>Operations</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/staff'}
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
              <small>{user.role.replace(/_/g, ' ')}</small>
              <span>{user.name}</span>
              <button className="btn small" onClick={handleLogout}>Sign out</button>
            </div>
          )}
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
