import { Navigate, Outlet } from 'react-router-dom';
import { getUser } from '../auth';

const ROLE_HOME: Record<string, string> = {
  STUDENT: '/student',
  ADMIN: '/admin',
  PLACEMENT_COORDINATOR: '/staff',
  COORDINATOR: '/staff',
  PEP_STAFF: '/staff',
};

export function ProtectedRoute({ allowed }: { allowed: string[] }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (!allowed.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role] ?? '/login'} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user.role] ?? '/login'} replace />;
}
