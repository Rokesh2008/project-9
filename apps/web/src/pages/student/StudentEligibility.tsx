import { useEffect, useState } from 'react';
import { api } from '../../api';
import { CycleSelector } from '../../components/CycleSelector';

type EligibilityData = {
  isEligible: boolean;
  failedRules: string[];
  evaluatedAt: string;
} | null;

export function StudentEligibility() {
  const [cycleId, setCycleId] = useState('');
  const [data, setData] = useState<EligibilityData>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cycleId) return;
    setLoading(true);
    setError('');
    api.get<EligibilityData>(`/my/eligibility/${cycleId}`)
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>Eligibility Status</h1>
        </div>
        <CycleSelector value={cycleId} onChange={setCycleId} />
      </header>

      {loading && <p className="empty-state">Loading...</p>}
      {error && <div className="notice">{error}</div>}

      {!loading && !error && !data && cycleId && (
        <p className="empty-state">Eligibility has not been evaluated yet for this cycle.</p>
      )}

      {data && (
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span className={`tag ${data.isEligible ? 'green' : 'red'}`} style={{ fontSize: '1.1rem', padding: '0.5rem 1rem' }}>
              {data.isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}
            </span>
            <small>Evaluated: {new Date(data.evaluatedAt).toLocaleString()}</small>
          </div>
          {!data.isEligible && data.failedRules.length > 0 && (
            <div>
              <h3>Failed Rules</h3>
              <ul>
                {data.failedRules.map((rule, i) => (
                  <li key={i}>{typeof rule === 'string' ? rule : JSON.stringify(rule)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
