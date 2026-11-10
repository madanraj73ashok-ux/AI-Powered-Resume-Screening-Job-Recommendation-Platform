import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRoleSuggestions, RoleSuggestion } from '../api/jobs';
import { Badge, Button, Card, SectionTitle, Spinner } from '../components/ui';

/**
 * Preliminary role directions right after resume review, before any interview.
 * Role ideas come from the local deterministic engine and are explicitly not
 * advertised vacancies; the Job matches page shows real discovered postings.
 */
export function RoleSuggestions({ resumeId }: { resumeId: string }) {
  const [roles, setRoles] = useState<RoleSuggestion[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRoleSuggestions(resumeId)
      .then((result) => {
        if (!cancelled) setRoles(result.resumeMissing ? [] : result.roles);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  if (failed) {
    return (
      <Card>
        <SectionTitle
          title="Job matches"
          subtitle="Local role suggestions and real vacancies are available from the Job matches page."
        />
        <Link to={`/jobs?resumeId=${encodeURIComponent(resumeId)}`}>
          <Button variant="secondary">Open Job matches</Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle
        title="Job matches"
        subtitle="Role directions from skills mentioned in this resume — not advertised vacancies. Real vacancies from public company boards are on the Job matches page; no interview is required to view them."
        action={
          <Link to={`/jobs?resumeId=${encodeURIComponent(resumeId)}`}>
            <Button variant="secondary">View real vacancies</Button>
          </Link>
        }
      />
      {roles === null ? (
        <Spinner label="Checking role directions…" />
      ) : roles.length === 0 ? (
        <p className="text-sm text-slate-500">
          No role directions yet — add skills or project evidence to the review above, then reopen this section.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {roles.slice(0, 4).map((role) => (
            <span
              key={role.role}
              className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-1.5 text-sm text-navy-800"
            >
              {role.role} <Badge color="navy">{role.coverage}%</Badge>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
