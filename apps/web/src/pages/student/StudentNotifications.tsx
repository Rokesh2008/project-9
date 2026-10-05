import { useEffect, useState } from 'react';
import { api } from '../../api';

type Notification = {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export function StudentNotifications() {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    api.get<Notification[]>('/my/notifications')
      .then((d) => setNotifs(Array.isArray(d) ? d : []))
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function markRead(id: string) {
    try {
      await api.patch(`/my/notifications/${id}/read`);
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="page"><p className="empty-state">Loading...</p></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">STUDENT PORTAL</p>
          <h1>Notifications</h1>
        </div>
        <button className="btn" onClick={load}>Refresh</button>
      </header>

      {error && <div className="notice">{error}</div>}

      {notifs.length === 0 ? (
        <p className="empty-state">No notifications.</p>
      ) : (
        <section className="card">
          <table className="data-table">
            <thead><tr><th>Message</th><th>Type</th><th>Date</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {notifs.map((n) => (
                <tr key={n.id} style={{ opacity: n.isRead ? 0.6 : 1 }}>
                  <td>{n.message}</td>
                  <td><span className="tag">{n.type}</span></td>
                  <td>{new Date(n.createdAt).toLocaleString()}</td>
                  <td>{n.isRead ? 'Read' : <strong>Unread</strong>}</td>
                  <td>{!n.isRead && <button className="btn small" onClick={() => markRead(n.id)}>Mark Read</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
