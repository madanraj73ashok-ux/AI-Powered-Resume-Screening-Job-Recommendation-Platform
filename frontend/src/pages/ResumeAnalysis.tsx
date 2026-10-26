import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  analyzeResume,
  downloadResumeFile,
  formatBytes,
  formatDate,
  getResume,
  listResumes,
  Resume,
  ResumeProfile,
  ResumeSkill,
  updateResumeProfile,
} from '../api/resumes';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  SectionTitle,
  Spinner,
} from '../components/ui';
import { useToast } from '../components/Toast';

const STATUS_COLORS: Record<string, 'green' | 'amber' | 'red' | 'navy' | 'slate'> = {
  'Ready for Assessment': 'green',
  'Verified Claims Recorded': 'green',
  'Needs Review': 'amber',
  'Evidence Requested': 'amber',
  'Verification Incomplete': 'amber',
  'Discrepancies Require Review': 'red',
};

function Evidence({ evidence }: { evidence?: { page?: number; quote?: string } | string | null }) {
  if (!evidence) return null;
  if (typeof evidence === 'string') {
    return <div className="mt-1 text-xs italic text-slate-400">“{evidence}”</div>;
  }
  return (
    <div className="mt-1 text-xs italic text-slate-400">
      “{evidence.quote}”{evidence.page ? ` — page ${evidence.page}` : ''}
    </div>
  );
}

export default function ResumeAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noResumes, setNoResumes] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [skillsText, setSkillsText] = useState('');

  const load = useCallback(async () => {
    setError(null);
    setNoResumes(false);
    try {
      if (!id) {
        const list = await listResumes();
        if (list.length === 0) {
          setNoResumes(true);
          setResume(null);
          return;
        }
        navigate(`/resume/${list[0].id}`, { replace: true });
        return;
      }
      const r = await getResume(id);
      setResume(r);
      setName(r.profile?.name ?? '');
      setEmail(r.profile?.contact?.email ?? '');
      setPhone(r.profile?.contact?.phone ?? '');
      setSummary(r.profile?.summary ?? '');
      setSkillsText((r.profile?.skills ?? []).map((s) => s.skill).join(', '));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const findings = useMemo(() => resume?.analysis?.findings ?? [], [resume]);
  const summaryMeta = resume?.analysis?.summary;

  const onSave = async () => {
    if (!resume) return;
    setSaving(true);
    setError(null);
    try {
      const parsedSkills: ResumeSkill[] = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((skill) => {
          const existing = (resume.profile?.skills ?? []).find(
            (s) => s.skill.toLowerCase() === skill.toLowerCase()
          );
          return existing ?? { skill, category: 'candidate_edited', count: 1, evidence: null };
        });

      const patch: Partial<ResumeProfile> = {
        name,
        contact: { email, phone, linkedin: resume.profile?.contact?.linkedin },
        summary,
        skills: parsedSkills,
      };
      const updated = await updateResumeProfile(resume.id, patch);
      setResume(updated);
      toast.show('Extracted information saved.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err));
      toast.show('Could not save changes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onDownload = async () => {
    if (!resume) return;
    setDownloading(true);
    try {
      await downloadResumeFile(resume.id, resume.originalName);
      toast.show('Original resume downloaded.', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : apiErrorMessage(err), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const onRerun = async () => {
    if (!resume) return;
    setAnalyzing(true);
    setError(null);
    try {
      const updated = await analyzeResume(resume.id);
      setResume(updated);
      toast.show('Analysis re-run completed.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) return <Spinner label="Loading resume analysis…" />;

  if (noResumes) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-navy-900">Resume analysis</h1>
        <EmptyState
          title="No resume to analyze yet"
          description="Upload a PDF or DOCX resume first. The local AI engine will extract skills, education, projects and experience and produce claim-level findings."
          action={
            <Link
              to="/resume/upload"
              className="rounded-lg bg-navy-700 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Upload resume
            </Link>
          }
        />
      </div>
    );
  }

  if (!resume) {
    return (
      <div className="space-y-4">
        <Alert>{error ?? 'Resume could not be loaded.'}</Alert>
        <Link to="/resume/upload" className="text-sm font-medium text-navy-700 underline">
          Back to upload
        </Link>
      </div>
    );
  }

  const profile = resume.profile ?? {};
  const extractionErrors = profile.extractionErrors ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Resume analysis</h1>
          <p className="mt-1 text-sm text-slate-500">
            {resume.originalName} · {formatBytes(resume.size)} · uploaded{' '}
            {formatDate(resume.createdAt)}
            {resume.profileEdited ? ' · corrections saved' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {resume.analysis?.analyzedAt ? (
            <Link to="/interview">
              <Button>Start AI interview</Button>
            </Link>
          ) : null}
          <Button variant="secondary" onClick={() => void onDownload()} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download original'}
          </Button>
          <Button variant="secondary" onClick={() => void onRerun()} disabled={analyzing}>
            {analyzing ? 'Analyzing…' : 'Re-run analysis'}
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save corrections'}
          </Button>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {extractionErrors.length > 0 ? (
        <Alert kind="info">
          {extractionErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-500">Status</div>
          <div className="mt-2">
            <Badge color={STATUS_COLORS[summaryMeta?.overallStatus ?? ''] ?? 'slate'}>
              {summaryMeta?.overallStatus ?? 'Not analyzed'}
            </Badge>
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-500">Skills detected</div>
          <div className="mt-1 text-2xl font-bold text-navy-900">
            {profile.skills?.length ?? 0}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-500">Findings</div>
          <div className="mt-1 text-2xl font-bold text-navy-900">
            {summaryMeta?.findingsCount ?? findings.length}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-slate-500">Warnings</div>
          <div className="mt-1 text-2xl font-bold text-navy-900">
            {summaryMeta?.warnings ?? 0}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Extracted information"
          subtitle="Review and correct anything the parser got wrong, then save."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="r-name">
              Name
            </label>
            <input id="r-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-email">
              Email
            </label>
            <input id="r-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-phone">
              Phone
            </label>
            <input id="r-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-skills">
              Skills (comma separated)
            </label>
            <input
              id="r-skills"
              className="input"
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="r-summary">
              Summary
            </label>
            <textarea
              id="r-summary"
              className="input min-h-[80px]"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle title="Education" subtitle="Extracted entries with source evidence" />
          {(profile.education ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No education entries were detected.</p>
          ) : (
            <ul className="space-y-3">
              {(profile.education ?? []).map((e, i) => (
                <li key={i} className="text-sm text-slate-700">
                  {e.text ?? e.degree}
                  {e.dates ? <span className="text-slate-400"> ({e.dates})</span> : null}
                  <Evidence evidence={e.evidence} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Experience" subtitle="Roles detected in the document" />
          {(profile.experience ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No experience entries were detected.</p>
          ) : (
            <ul className="space-y-3">
              {(profile.experience ?? []).map((e, i) => (
                <li key={i} className="text-sm text-slate-700">
                  {e.text}
                  {e.dates ? <span className="text-slate-400"> · {e.dates}</span> : null}
                  <Evidence evidence={e.evidence} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Projects" subtitle="Project mentions and descriptions" />
          {(profile.projects ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">
              No projects section was detected. You can add one to your resume for stronger
              evidence.
            </p>
          ) : (
            <ul className="space-y-3">
              {(profile.projects ?? []).map((p, i) => (
                <li key={i} className="text-sm text-slate-700">
                  {p.text}
                  <Evidence evidence={p.evidence} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Skills" subtitle="Claimed skills with document evidence" />
          {(profile.skills ?? []).length === 0 ? (
            <p className="text-sm text-slate-500">No skills were detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(profile.skills ?? []).map((s, i) => (
                <span
                  key={`${s.skill}-${i}`}
                  title={
                    typeof s.evidence === 'object' && s.evidence?.quote
                      ? s.evidence.quote
                      : s.category ?? ''
                  }
                  className="rounded-full bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-800 ring-1 ring-navy-100"
                >
                  {s.skill}
                  {s.level ? <span className="text-navy-400"> · {s.level}</span> : null}
                </span>
              ))}
            </div>
          )}
          {(profile.certifications ?? []).length > 0 ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Certifications
              </div>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {(profile.certifications ?? []).map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      {[
        { title: 'Achievements', entries: profile.achievements ?? [] },
        { title: 'Claimed responsibilities', entries: profile.responsibilities ?? [] },
      ].filter(group => group.entries.length > 0).map(group => <Card key={group.title}>
        <SectionTitle title={group.title} subtitle="Literal resume statements with source evidence" />
        <ul className="space-y-3 text-sm text-slate-700">{group.entries.map((item, index) => <li key={index}>
          {item.text}<Evidence evidence={item.evidence} />
        </li>)}</ul>
      </Card>)}
      <Card>
        <SectionTitle
          title="Claim-level findings"
          subtitle="Deterministic local analysis. “Verified” means supported by the resume text, not independently confirmed."
        />
        {findings.length === 0 ? (
          <p className="text-sm text-slate-500">No findings recorded for this resume.</p>
        ) : (
          <ul className="space-y-4">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-navy-900">{f.claim}</div>
                  <Badge color={STATUS_COLORS[f.status] ?? 'slate'}>{f.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-700">{f.finding}</p>
                <p className="mt-1 text-xs text-slate-500">{f.reason}</p>
                {f.evidence ? (
                  <div className="mt-2 rounded bg-slate-50 px-3 py-2">
                    <Evidence evidence={f.evidence} />
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>
                    Method: <span className="text-slate-700">{f.method}</span>
                  </span>
                  {f.confidence !== null && f.confidence !== undefined ? (
                    <span>
                      Confidence: <span className="text-slate-700">{Math.round(f.confidence * 100)}%</span>
                    </span>
                  ) : null}
                </div>
                {f.suggestedFollowUp ? (
                  <p className="mt-2 text-xs text-navy-700">
                    <span className="font-semibold">Suggested follow-up:</span> {f.suggestedFollowUp}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
