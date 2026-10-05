import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../auth';

const NAV = [
  { to: '/student', label: 'Dashboard', icon: 'D' },
  { to: '/student/profile', label: 'Profile', icon: 'P' },
  { to: '/student/eligibility', label: 'Eligibility', icon: 'E' },
  { to: '/student/scores', label: 'Scores', icon: 'S' },
  { to: '/student/ranking', label: 'Ranking', icon: 'R' },
  { to: '/student/preferences', label: 'Preferences', icon: 'F' },
  { to: '/student/allocation', label: 'Allocation', icon: 'A' },
  { to: '/student/advisory', label: 'AI Advisory', icon: 'Q' },
  { to: '/student/notifications', label: 'Notifications', icon: 'N' },
];

export function StudentLayout() {
  const navigate = useNavigate();
  const user = getUser();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar student-sidebar">
        <div className="sidebar-brand">
          <span className="logo">P9</span>
          <div>
            <strong>Student Portal</strong>
            <small>My Journey</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/student'}
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
              <small>STUDENT</small>
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
