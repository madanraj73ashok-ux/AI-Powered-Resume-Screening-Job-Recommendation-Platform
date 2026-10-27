import { useState } from 'react';
import client, { apiErrorMessage } from '../api/client';
import { Alert, Button, Card, SectionTitle } from './ui';

export const DOMAIN_OPTIONS = [
  ['software_it', 'Software and IT'], ['robotics_automation', 'Robotics and automation'],
  ['electronics_embedded', 'Electronics and embedded systems'], ['data_analytics', 'Data analytics'],
  ['mechanical_core', 'Mechanical engineering'], ['general', 'General project and work skills'],
];
interface Detection { suggestedDomains: string[]; uncertain: boolean; ranked: {
  domain: string; label: string; score: number; matchedSkills: string[];
  evidence?: { excerpt: string }[]; reasons?: string[];
}[] }
export function DomainReview({ id, confirmed = [] }: { id: string; confirmed?: string[] }) {
  const [selected, setSelected] = useState(confirmed), [detection, setDetection] = useState<Detection | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function detect() {
    setBusy(true); setMessage('');
    try { const result = (await client.post(`/resumes/${id}/domains/detect`)).data;
      setDetection(result.detection); if (!selected.length) setSelected(result.detection.suggestedDomains);
    } catch (error) { setMessage(apiErrorMessage(error)); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true);
    try { await client.put(`/resumes/${id}/domains`, { confirmedDomains: selected }); setMessage('Interview domains confirmed. New interviews will use your selection.'); }
    catch (error) { setMessage(apiErrorMessage(error)); } finally { setBusy(false); }
  }
  return <Card><SectionTitle title="Choose your interview domains" subtitle="Confirm up to three domains. Your selection controls the question bank; personal details and college name are excluded from classification." />
    {message && <Alert kind="info">{message}</Alert>}
    <div className="my-4 grid gap-3 sm:grid-cols-2">{DOMAIN_OPTIONS.map(([value, label]) => <label key={value} className="flex gap-2 text-sm">
      <input type="checkbox" checked={selected.includes(value)} disabled={!selected.includes(value) && selected.length >= 3}
        onChange={event => setSelected(previous => event.target.checked ? [...previous, value] : previous.filter(x => x !== value))} />{label}
    </label>)}</div>
    {detection && <div className="mb-4 space-y-2 text-sm text-slate-600">
      <p>{detection.uncertain ? 'The domain is uncertain. Which area would you like to discuss?' : 'Suggested domains from technical evidence:'}</p>
      {detection.ranked.slice(0, 3).map(item => <details key={item.domain}>
        <summary>{item.label} · evidence signal {item.score}/100</summary>
        <p>{item.matchedSkills.join(', ') || 'No direct taxonomy skill match.'}</p>
        {item.evidence?.map((entry, i) => <p key={i} className="mt-1 italic">“{entry.excerpt}”</p>)}
      </details>)}<p className="text-xs">Signals are uncalibrated similarity measures, not probabilities or competence scores.</p>
    </div>}
    <div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => void detect()}>Detect from resume evidence</Button>
      <Button disabled={busy || !selected.length} onClick={() => void confirm()}>Confirm domains</Button></div>
  </Card>;
}
