import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import client, { apiErrorMessage } from '../api/client';
import { Alert, Button, Card, SectionTitle } from '../components/ui';

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [profileMsg, setProfileMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );
  const [profileBusy, setProfileBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  if (!user) return null;

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileBusy(true);
    try {
      await client.put('/auth/profile', { name });
      await refresh();
      setProfileMsg({ kind: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ kind: 'error', text: apiErrorMessage(err) });
    } finally {
      setProfileBusy(false);
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setPwBusy(true);
    try {
      await client.post('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwMsg({ kind: 'success', text: 'Password changed.' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: apiErrorMessage(err) });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Profile &amp; security</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your display name and password.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle title="Display name" />
          {profileMsg ? (
            <div className="mb-3">
              <Alert kind={profileMsg.kind}>{profileMsg.text}</Alert>
            </div>
          ) : null}
          <form onSubmit={onSaveProfile} className="space-y-4">
            <div>
              <label className="label" htmlFor="profile-name">
                Name
              </label>
              <input
                id="profile-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="text-sm text-slate-500">
              Email: <span className="font-medium text-slate-700">{user.email}</span>
              <br />
              <span className="text-xs">Email changes are not supported.</span>
            </div>
            <Button type="submit" disabled={profileBusy}>
              {profileBusy ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle title="Change password" />
          {pwMsg ? (
            <div className="mb-3">
              <Alert kind={pwMsg.kind}>{pwMsg.text}</Alert>
            </div>
          ) : null}
          <form onSubmit={onChangePassword} className="space-y-4">
            <div>
              <label className="label" htmlFor="current-password">
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={pwBusy} variant="secondary">
              {pwBusy ? 'Updating…' : 'Change password'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
