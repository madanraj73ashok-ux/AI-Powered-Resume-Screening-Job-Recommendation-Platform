import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <Card className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-navy-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you are looking for does not exist or has moved.
        </p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-lg bg-navy-700 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
        >
          Go to dashboard
        </Link>
      </Card>
    </div>
  );
}
