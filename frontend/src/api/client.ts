import axios from 'axios';

// All requests go to the same origin; the Vite dev server proxies /api to the
// Express backend. The session is an httpOnly cookie (no token in JS).
const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 30000,
});

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (err.code === 'ERR_NETWORK') {
      return 'Cannot reach the API server. Is the backend running on port 4000?';
    }
  }
  return 'Something went wrong. Please try again.';
}

export default client;
