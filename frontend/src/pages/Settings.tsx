import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Badge, Card, SectionTitle } from '../components/ui';

interface Health {
  status: string;
  db: { connected: boolean; engine: string; mongoState: number };
  uptimeSeconds: number;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await client.get('/health');
        if (!cancelled) {
          setHealth(res.data as Health);
          setHealthError(false);
        }
      } catch {
        if (!cancelled) setHealthError(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const engine = health?.db.engine ?? '';
  const usingMemory = engine.includes('in-memory');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Account and system configuration. Data is stored in MongoDB.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle title="Account" subtitle="Your sign-in details" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-navy-900">{user?.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-navy-900">{user?.email}</dd>
            </div>
          </dl>
          <Link
            to="/profile"
            className="mt-4 inline-block text-sm font-medium text-navy-700 hover:underline"
          >
            Edit profile and change password →
          </Link>
        </Card>

        <Card>
          <SectionTitle
            title="System status"
            subtitle="Live check of the API and database (refreshes every 15s)"
          />
          {healthError ? (
            <p className="text-sm text-red-700">Backend unreachable.</p>
          ) : !health ? (
            <p className="text-sm text-slate-500">Checking…</p>
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">API</dt>
                <dd>
                  <Badge color={health.status === 'ok' ? 'green' : 'red'}>{health.status}</Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Database</dt>
                <dd>
                  <Badge color={health.db.connected ? 'green' : 'red'}>
                    {health.db.connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Storage engine</dt>
                <dd className="font-medium text-navy-900">{engine || '—'}</dd>
              </div>
              {usingMemory ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  The backend fell back to an in-memory database. Data will be lost when it
                  restarts. Start MongoDB (or set MONGODB_URI) for persistent storage.
                </div>
              ) : null}
            </dl>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle title="Local AI processing" />
        <p className="text-sm text-slate-600">
          Resumes are parsed and analyzed by a local Python engine (FastAPI + scikit-learn +
          pdfplumber/python-docx). No paid external AI APIs are used and no resume content leaves
          this machine. The engine runs on 127.0.0.1:8000 and is not exposed publicly.
        </p>
      </Card>
    </div>
  );
}
