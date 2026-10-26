import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  deleteResume,
  formatBytes,
  formatDate,
  listResumes,
  uploadResume,
  Resume,
} from '../api/resumes';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const MAX_MB = 5;
const ACCEPTED = ['.pdf', '.docx'];

function validate(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
    return 'Only PDF and DOCX files are accepted.';
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return `The file is too large. Maximum size is ${MAX_MB} MB.`;
  }
  if (file.size === 0) {
    return 'The file is empty.';
  }
  return null;
}

export default function UploadResumePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setResumes(await listResumes());
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pick = (f: File | null | undefined) => {
    setError(null);
    if (!f) return;
    const problem = validate(f);
    if (problem) {
      setError(problem);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const startUpload = async () => {
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const resume = await uploadResume(file, setProgress);
      toast.show('Resume uploaded and analyzed.', 'success');
      setFile(null);
      await refresh();
      navigate(`/resume/${resume.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
      toast.show('Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this resume permanently? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await deleteResume(id);
      toast.show('Resume deleted.', 'success');
      await refresh();
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Upload resume</h1>
        <p className="mt-1 text-sm text-slate-500">
          PDF or DOCX, up to {MAX_MB} MB. Files are parsed locally by the AI engine and stored
          privately under your account.
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragOver ? 'border-navy-500 bg-navy-50' : 'border-slate-300 bg-slate-50'
          }`}
        >
          <div className="text-sm font-medium text-navy-900">
            {file ? file.name : 'Drag and drop your resume here'}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {file
              ? `${formatBytes(file.size)} · ready to upload`
              : 'Supported formats: PDF, DOCX'}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>
              Browse files
            </Button>
            {file ? (
              <Button onClick={() => void startUpload()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload & analyze'}
              </Button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {uploading ? (
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-navy-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            {progress === 100 ? (
              <p className="mt-2 text-xs text-slate-500">
                Upload complete — extracting text, skills, education and experience locally…
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle title="Your resumes" subtitle="All documents you have uploaded" />
        {loading ? (
          <Spinner label="Loading resumes…" />
        ) : resumes.length === 0 ? (
          <EmptyState
            title="No resumes yet"
            description="Upload a PDF or DOCX resume to extract skills, education, projects and experience, and to see claim-level findings."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {resumes.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/resume/${r.id}`}
                      className="truncate font-medium text-navy-800 hover:underline"
                    >
                      {r.originalName}
                    </Link>
                    <Badge color={r.status === 'processed' ? 'green' : 'red'}>
                      {r.status === 'processed' ? 'Processed' : 'Failed'}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatBytes(r.size)} · uploaded {formatDate(r.createdAt)} ·{' '}
                    {r.profile?.skills?.length ?? 0} skills extracted
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" onClick={() => navigate(`/resume/${r.id}`)}>
                    View analysis
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void onDelete(r.id)}
                    disabled={deletingId === r.id}
                  >
                    {deletingId === r.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
