import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import DashboardPage from './pages/Dashboard';
import ProfilePage from './pages/Profile';
import UploadResumePage from './pages/UploadResume';
import ResumeAnalysisPage from './pages/ResumeAnalysis';
import InterviewStartPage from './pages/InterviewStart';
import InterviewSessionPage from './pages/InterviewSession';
import InterviewResultsPage from './pages/InterviewResults';
import SettingsPage from './pages/Settings';
import NotFoundPage from './pages/NotFound';

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function CandidateOnly({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute roles={['candidate']}>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <ProfilePage />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <SettingsPage />
          </Protected>
        }
      />
      <Route
        path="/resume/upload"
        element={
          <CandidateOnly>
            <UploadResumePage />
          </CandidateOnly>
        }
      />
      <Route
        path="/resume"
        element={
          <CandidateOnly>
            <ResumeAnalysisPage />
          </CandidateOnly>
        }
      />
      <Route
        path="/resume/:id"
        element={
          <CandidateOnly>
            <ResumeAnalysisPage />
          </CandidateOnly>
        }
      />
      <Route
        path="/interview"
        element={
          <CandidateOnly>
            <InterviewStartPage />
          </CandidateOnly>
        }
      />
      <Route
        path="/interview/results"
        element={
          <CandidateOnly>
            <InterviewResultsPage />
          </CandidateOnly>
        }
      />
      <Route
        path="/interview/results/:id"
        element={
          <CandidateOnly>
            <InterviewResultsPage />
          </CandidateOnly>
        }
      />
      <Route
        path="/interview/:id"
        element={
          <CandidateOnly>
            <InterviewSessionPage />
          </CandidateOnly>
        }
      />
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
