import { useEffect, useState } from 'react';
import { api } from '../../api';

type Profile = {
  id: string;
  studentId: string;
  name: string;
  email: string;
  isActive: boolean;
  batch?: { batchIdentifier: string; academicYear: string; department?: { code: string; name: string } };
  assessmentResults: Array<{ id: string; sourceIdentifier: string; assessmentType: string; score: number; maxScore?: number }>;
};

export function StudentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Profile>('/my/profile')
      .then(setProfile)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><p className="empty-state">Loading...</p></div>;
  if (error) return <div className="page"><div className="notice">{error}</div></div>;
  if (!profile) return null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>My Profile</h1>
        </div>
      </header>

      <section className="card">
        <h2>Personal Information</h2>
        <table className="data-table">
          <tbody>
            <tr><td><strong>Student ID</strong></td><td>{profile.studentId}</td></tr>
            <tr><td><strong>Name</strong></td><td>{profile.name}</td></tr>
            <tr><td><strong>Email</strong></td><td>{profile.email}</td></tr>
            <tr><td><strong>Status</strong></td><td>{profile.isActive ? 'Active' : 'Inactive'}</td></tr>
            {profile.batch && (
              <>
                <tr><td><strong>Batch</strong></td><td>{profile.batch.batchIdentifier} ({profile.batch.academicYear})</td></tr>
                {profile.batch.department && (
                  <tr><td><strong>Department</strong></td><td>{profile.batch.department.name} ({profile.batch.department.code})</td></tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Assessment Results</h2>
        {profile.assessmentResults.length === 0 ? (
          <p className="empty-state">No assessments recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Source</th><th>Type</th><th>Score</th><th>Max</th></tr>
            </thead>
            <tbody>
              {profile.assessmentResults.map((a) => (
                <tr key={a.id}>
                  <td>{a.sourceIdentifier}</td>
                  <td>{a.assessmentType}</td>
                  <td>{a.score}</td>
                  <td>{a.maxScore ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
