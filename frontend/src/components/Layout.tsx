import { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Badge } from './ui';
import { UserRole } from '../types';
import {
  DashboardIcon,
  ProfileIcon,
  UploadIcon,
  AnalysisIcon,
  InterviewIcon,
  ResultsIcon,
  SignOutIcon,
  SettingsIcon,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  roles: UserRole[];
  icon: (p: { className?: string }) => JSX.Element;
  end?: boolean;
}

// Items are added as their pages are implemented in each phase.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', roles: ['candidate', 'recruiter', 'admin'], icon: DashboardIcon, end: true },
  { to: '/resume/upload', label: 'Upload Resume', roles: ['candidate'], icon: UploadIcon },
  { to: '/resume', label: 'Resume Analysis', roles: ['candidate'], icon: AnalysisIcon },
  { to: '/assessment', label: 'Assessment Test', roles: ['candidate'], icon: AnalysisIcon },
  { to: '/interview', label: 'AI Interview', roles: ['candidate'], icon: InterviewIcon, end: true },
  { to: '/interview/results', label: 'Interview Results', roles: ['candidate'], icon: ResultsIcon },
  { to: '/profile', label: 'My Profile', roles: ['candidate', 'recruiter', 'admin'], icon: ProfileIcon },
  { to: '/settings', label: 'Settings', roles: ['candidate', 'recruiter', 'admin'], icon: SettingsIcon },
];

const ROLE_LABEL: Record<UserRole, string> = {
  candidate: 'Candidate',
  recruiter: 'Recruiter',
  admin: 'Administrator',
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const items = NAV_ITEMS.filter((i) => (user ? i.roles.includes(user.role) : false));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy-900 text-navy-100 md:flex">
        <div className="border-b border-navy-800 px-5 py-5">
          <div className="text-lg font-bold tracking-tight text-white">
            VeriHire <span className="text-sky-400">AI</span>
          </div>
          <p className="mt-1 text-xs text-navy-300">Local-first hiring intelligence</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-navy-800 text-white shadow-inner'
                      : 'text-navy-200 hover:bg-navy-800/60 hover:text-white'
                  }`
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-navy-800 px-4 py-4">
          <div className="truncate text-sm font-medium text-white">{user?.name}</div>
          <div className="mt-1">
            <Badge color="navy">{user ? ROLE_LABEL[user.role] : ''}</Badge>
          </div>
          <button
            onClick={() => void handleLogout()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-navy-700 px-3 py-2 text-xs font-medium text-navy-200 transition hover:bg-navy-800 hover:text-white"
          >
            <SignOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <div className="font-bold text-navy-900">
            VeriHire <span className="text-sky-500">AI</span>
          </div>
          <button
            onClick={() => void handleLogout()}
            className="text-xs font-medium text-navy-700 underline"
          >
            Sign out
          </button>
        </div>
        <nav aria-label="Mobile navigation" className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `shrink-0 rounded px-3 py-2 text-sm ${isActive ? 'bg-navy-100 font-semibold text-navy-900' : 'text-slate-600'}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </div>
    </div>
  );
}
