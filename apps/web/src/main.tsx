import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './components/AdminLayout';
import { ProtectedRoute, RootRedirect } from './components/ProtectedRoute';
import { StaffLayout } from './components/StaffLayout';
import { StudentLayout } from './components/StudentLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AuditLogs } from './pages/admin/AuditLogs';
import { CyclesManagement } from './pages/admin/CyclesManagement';
import { DomainsManagement } from './pages/admin/DomainsManagement';
import { UsersManagement } from './pages/admin/UsersManagement';
import { Allocations } from './pages/Allocations';
import { Classification } from './pages/Classification';
import { Dashboard } from './pages/Dashboard';
import { Eligibility } from './pages/Eligibility';
import { Import } from './pages/Import';
import { Intelligence } from './pages/Intelligence';
import { Login } from './pages/Login';
import { Ranking } from './pages/Ranking';
import { Reports } from './pages/Reports';
import { Scoring } from './pages/Scoring';
import { Students } from './pages/Students';
import { StudentAdvisory } from './pages/student/StudentAdvisory';
import { StudentAllocation } from './pages/student/StudentAllocation';
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentEligibility } from './pages/student/StudentEligibility';
import { StudentNotifications } from './pages/student/StudentNotifications';
import { StudentPreferences } from './pages/student/StudentPreferences';
import { StudentProfile } from './pages/student/StudentProfile';
import { StudentRanking } from './pages/student/StudentRanking';
import { StudentScores } from './pages/student/StudentScores';
import './app.css';

const STAFF_ROLES = ['PLACEMENT_COORDINATOR', 'COORDINATOR', 'PEP_STAFF'];

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route index element={<RootRedirect />} />

        {/* Student Portal */}
        <Route element={<ProtectedRoute allowed={['STUDENT']} />}>
          <Route element={<StudentLayout />}>
            <Route path="student" element={<StudentDashboard />} />
            <Route path="student/profile" element={<StudentProfile />} />
            <Route path="student/eligibility" element={<StudentEligibility />} />
            <Route path="student/scores" element={<StudentScores />} />
            <Route path="student/ranking" element={<StudentRanking />} />
            <Route path="student/preferences" element={<StudentPreferences />} />
            <Route path="student/allocation" element={<StudentAllocation />} />
            <Route path="student/advisory" element={<StudentAdvisory />} />
            <Route path="student/notifications" element={<StudentNotifications />} />
          </Route>
        </Route>

        {/* Staff Portal */}
        <Route element={<ProtectedRoute allowed={STAFF_ROLES} />}>
          <Route element={<StaffLayout />}>
            <Route path="staff" element={<Dashboard />} />
            <Route path="staff/import" element={<Import />} />
            <Route path="staff/students" element={<Students />} />
            <Route path="staff/eligibility" element={<Eligibility />} />
            <Route path="staff/scoring" element={<Scoring />} />
            <Route path="staff/ranking" element={<Ranking />} />
            <Route path="staff/classification" element={<Classification />} />
            <Route path="staff/allocations" element={<Allocations />} />
            <Route path="staff/intelligence" element={<Intelligence />} />
            <Route path="staff/reports" element={<Reports />} />
          </Route>
        </Route>

        {/* Admin Portal */}
        <Route element={<ProtectedRoute allowed={['ADMIN']} />}>
          <Route element={<AdminLayout />}>
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/users" element={<UsersManagement />} />
            <Route path="admin/students" element={<Students />} />
            <Route path="admin/import" element={<Import />} />
            <Route path="admin/cycles" element={<CyclesManagement />} />
            <Route path="admin/domains" element={<DomainsManagement />} />
            <Route path="admin/eligibility" element={<Eligibility />} />
            <Route path="admin/scoring" element={<Scoring />} />
            <Route path="admin/ranking" element={<Ranking />} />
            <Route path="admin/classification" element={<Classification />} />
            <Route path="admin/allocations" element={<Allocations />} />
            <Route path="admin/intelligence" element={<Intelligence />} />
            <Route path="admin/reports" element={<Reports />} />
            <Route path="admin/audit" element={<AuditLogs />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
