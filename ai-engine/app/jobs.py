"""Explainable local job matching and vacancy-link classification.

No network requests and no hiring probabilities: matching is deterministic, and
every application link is labeled from what the provider actually exposes.
"""
import html
import ipaddress
import re
from urllib.parse import parse_qs, urlparse
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .skills import detect_skills, normalize_skill

router = APIRouter(prefix='/jobs')

LINK_LABELS = {'apply_now': 'Apply Now', 'view_job': 'View Job', 'search_openings': 'Search Openings', 'unavailable': 'Link unavailable'}
_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
_NUMERIC_ID = re.compile(r'^\d{4,}$')
_JOB_WORD = re.compile(r'^(jobs?|positions?|openings?|vacancies|opportunit(?:y|ies)|careers?|apply|postings?)$', re.I)
ROLE_SKILLS = {
    'Python Developer': ['Python', 'Git', 'REST APIs', 'Unit Testing'],
    'Junior Data Analyst': ['Python', 'SQL', 'Excel', 'Data Analysis'],
    'Business Intelligence Analyst': ['Power BI', 'SQL', 'DAX', 'Data Visualization'],
    'Junior NLP Engineer': ['Python', 'NLP', 'Machine Learning', 'scikit-learn'],
    'Machine Learning Intern': ['Python', 'Machine Learning', 'Pandas', 'NumPy'],
    'SQL Developer': ['SQL', 'MySQL', 'PostgreSQL'],
    'Frontend Developer': ['React', 'JavaScript', 'TypeScript', 'Git'],
    'Embedded Systems / Robotics Intern': ['Embedded C', 'Arduino', 'PLC', 'Python'],
}
LEARNING = {
    'SQL': 'Practice joins, grouping, subqueries and window functions on a documented dataset.',
    'DAX': 'Build and explain filter-context-aware DAX measures in a portfolio dashboard.',
    'Power BI': 'Build a dashboard with Power Query, a star schema and reconciled measures.',
    'Git': 'Practice commits, branches, pull requests and conflict resolution on a small project.',
    'Unit Testing': 'Add meaningful unit and integration tests, including failures and edge cases.',
}


def plain_text(value):
    value = html.unescape(html.unescape(str(value or '')))
    value = re.sub(r'<(?:br|/p|/li|/h[1-6]|/div)[^>]*>', '\n', value, flags=re.I)
    return re.sub(r'<[^>]+>', ' ', value).strip()


def _parse_http_url(value):
    text = str(value or '').strip()
    if not text or len(text) > 2048 or '\\' in text:
        return None
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    try:
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme != 'https' or not parsed.netloc or not host or parsed.username or parsed.password or port not in (None, 443):
        return None
    if host.lower() == 'localhost' or host.lower().endswith(('.local', '.localhost', '.internal')):
        return None
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass
    return parsed


def _domain(host, domain):
    return host == domain or host.endswith('.' + domain)


def _path_segments(parsed):
    return [segment for segment in (parsed.path or '').split('/') if segment]


def _is_job_specific(parsed):
    """A posting page identifies one vacancy (an id-like path segment or a posting query key)."""
    host = (parsed.hostname or '').lower()
    segments = _path_segments(parsed)
    query = parse_qs(parsed.query or '')
    if any(key in query for key in ('gh_jid', 'jobId', 'job_id', 'postingId', 'posting')):
        return True
    if not segments:
        return False
    if _domain(host, 'greenhouse.io') and len(segments) >= 3 and segments[-2].lower() == 'jobs':
        return bool(_NUMERIC_ID.match(segments[-1]) or len(segments[-1]) >= 4)
    if any(_UUID.match(segment) or _NUMERIC_ID.match(segment) for segment in segments):
        return True
    for index, segment in enumerate(segments[:-1]):
        if _JOB_WORD.match(segment) and segments[index + 1].lower() not in {'search', 'all', 'list', 'new'}:
            return True
    return False


def _is_board_page(parsed):
    """A board or search page lists many vacancies; it is not an application page."""
    segments = _path_segments(parsed)
    if not segments:
        return False
    if any(_JOB_WORD.match(segment) or segment.lower() == 'search' for segment in segments):
        return True
    host = (parsed.hostname or '').lower()
    return (_domain(host, 'greenhouse.io') or _domain(host, 'lever.co')) and len(segments) <= 2


def _verified_application_url(apply, job):
    """Apply Now requires a provider-documented posting-specific application form."""
    host = (apply.hostname or '').lower()
    segments = _path_segments(apply)
    query = parse_qs(apply.query or '')
    if job is None:
        return False
    job_host = (job.hostname or '').lower()
    job_segments = _path_segments(job)
    if host in ('jobs.lever.co', 'jobs.eu.lever.co') and host == job_host:
        # Lever's public postings API returns applyUrl as /{company}/{posting-id}/apply.
        return (len(segments) == 3 and len(job_segments) == 2 and segments[:2] == job_segments
                and segments[-1].lower() == 'apply' and bool(_UUID.match(segments[1])))
    if host in ('boards.greenhouse.io', 'job-boards.greenhouse.io') and job_host in ('boards.greenhouse.io', 'job-boards.greenhouse.io'):
        return (segments == ['embed', 'job_app'] and len(job_segments) == 3 and job_segments[1] == 'jobs'
                and query.get('for') == [job_segments[0]] and query.get('token') == [job_segments[2]]
                and bool(_NUMERIC_ID.match(job_segments[2])))
    return False


def classify_application_url(job_url, apply_url=None):
    """Label a vacancy link honestly: Apply Now only for a verified application form.

    Returns {linkKind, linkLabel, url, verified, reason}. `url` is empty when no
    safe http(s) link exists, so a caller can never present a broken link as an
    application form.
    """
    job = _parse_http_url(job_url)
    apply = _parse_http_url(apply_url)
    # A documented application-form pattern is inherently posting-specific.
    if apply is not None and _verified_application_url(apply, job):
        return {'linkKind': 'apply_now', 'linkLabel': LINK_LABELS['apply_now'], 'url': str(apply_url).strip(),
                'verified': True, 'reason': 'The provider documents this as the posting-specific application form.'}
    if job is not None and _is_job_specific(job):
        return {'linkKind': 'view_job', 'linkLabel': LINK_LABELS['view_job'], 'url': str(job_url).strip(),
                'verified': False, 'reason': 'Job-specific posting page; the employer hosts the application form there.'}
    if job is not None and _is_board_page(job):
        return {'linkKind': 'search_openings', 'linkLabel': LINK_LABELS['search_openings'], 'url': str(job_url).strip(),
                'verified': False, 'reason': 'This is a board or search page, not a single vacancy.'}
    return {'linkKind': 'unavailable', 'linkLabel': LINK_LABELS['unavailable'], 'url': '', 'verified': False,
            'reason': 'No safe http(s) link is available; do not present it as an application link.'}


def parse_job(job):
    text = plain_text(job.get('description', ''))[:30000]
    required, preferred, section = set(), set(), None
    for line in text.splitlines():
        lower = line.lower().strip()
        if re.search(r'nice.to.have|preferred|bonus|ideally', lower):
            section = 'preferred'
        elif re.search(r'requirements|qualifications|what you.ll bring|what we.re looking for|you should have|required skills', lower):
            section = 'required'
        elif re.search(r'benefits|what we offer|equal opportunity|about (us|the company)', lower):
            section = None
        skills = {x['skill'] for x in detect_skills(line)}
        if section == 'required': required |= skills
        if section == 'preferred': preferred |= skills
    mentioned = {x['skill'] for x in detect_skills(text)}
    confidence = 'requirements section' if required else 'description mentions; mandatory status unknown'
    if not required: required = mentioned - preferred
    preferred -= required
    years = re.search(r'(\d{1,2})\s*(?:\+|[-–]\s*\d{1,2})?\s*(?:years|yrs)(?:\s+of)?\s+(?:relevant\s+|professional\s+|industry\s+|work\s+)?experience', text, re.I)
    title = str(job.get('title', ''))
    level = ('Internship' if re.search(r'\bintern(ship)?\b', title, re.I) else
             'Entry level' if re.search(r'junior|graduate|entry.level|fresher', title, re.I) else
             'Experienced' if years and int(years[1]) >= 2 else 'Not specified')
    return {'requiredSkills': sorted(required), 'preferredSkills': sorted(preferred),
            'requirementsConfidence': confidence, 'minExperienceYears': int(years[1]) if years else None,
            'experienceEvidence': years[0] if years else None, 'level': level, 'description': text}


def candidate_evidence(profile, full_text=''):
    name = str(profile.get('name') or '')
    skills = {}
    actual_text = full_text.replace(name, '') if name else full_text
    actual = {s['skill'] for s in detect_skills(actual_text)}
    for item in profile.get('skills') or []:
        normalized = normalize_skill(str(item.get('skill') or ''))
        if not normalized or (normalized == 'R' and full_text and normalized not in actual): continue
        if normalized == 'Oracle':
            # A vendor/certification name alone does not establish database experience.
            continue
        skills[normalized] = {'skill': normalized, 'evidence': item.get('evidence'), 'categories': ['Mentioned in resume']}
    for found in detect_skills(actual_text):
        skills.setdefault(found['skill'], {'skill': found['skill'], 'evidence': {'quote': found['evidence']}, 'categories': ['Mentioned in resume']})
    for section, label in [('projects', 'Supported by project'), ('experience', 'Supported by experience'),
                           ('responsibilities', 'Supported by experience'), ('certifications', 'Supported by certification')]:
        for item in profile.get(section) or []:
            for found in detect_skills(str(item.get('text') or '')):
                entry = skills.setdefault(found['skill'], {'skill': found['skill'], 'evidence': item.get('evidence'), 'categories': ['Mentioned in resume']})
                if label not in entry['categories']: entry['categories'].append(label)
                if item.get('evidence'): entry['evidence'] = item['evidence']
    return skills


def _job_info(job):
    """Use provider-parsed skills when supplied; otherwise parse the description here."""
    if 'requiredSkills' in job or 'preferredSkills' in job:
        years = job.get('minExperienceYears')
        return {'requiredSkills': sorted({str(x) for x in job.get('requiredSkills') or []}),
                'preferredSkills': sorted({str(x) for x in job.get('preferredSkills') or []}),
                'requirementsConfidence': str(job.get('requirementsConfidence') or 'not parsed'),
                'minExperienceYears': years if isinstance(years, (int, float)) else None,
                'experienceEvidence': job.get('experienceEvidence') or None,
                'level': str(job.get('level') or 'Not specified'),
                'description': plain_text(job.get('description', ''))[:3000]}
    return parse_job(job)


def recommend(profile, full_text, jobs, interview_scores=None, preferences=None):
    preferences = preferences or {}
    evidence = candidate_evidence(profile, full_text)
    owned = set(evidence)
    interview = {normalize_skill(x.get('skill', '')): x['percentage'] / 100
                 for x in (interview_scores or []) if isinstance(x.get('percentage'), (int, float))}
    for skill, score in interview.items():
        if skill in evidence and score >= .7: evidence[skill]['categories'].append('Demonstrated in interview (rubric estimate)')
    roles = sorted([{'role': role, 'matchingSkills': sorted(set(skills) & owned),
                     'coverage': round(100 * len(set(skills) & owned) / len(skills)),
                     'note': 'Role idea from a curated skill map; not an advertised vacancy or experience claim.'}
                    for role, skills in ROLE_SKILLS.items() if set(skills) & owned], key=lambda x: -x['coverage'])[:6]
    parsed = [_job_info(job) for job in jobs]
    profile_text = ' '.join([str(profile.get('summary') or ''), ' '.join(owned)] +
                            [str(x.get('text') or '') for field in ('projects', 'experience') for x in profile.get(field) or []])
    try:
        vectors = TfidfVectorizer(stop_words='english', max_features=20000).fit_transform(
            [profile_text] + [str(j.get('title', '')) + ' ' + p['description'] for j, p in zip(jobs, parsed)])
        similarity = cosine_similarity(vectors[0:1], vectors[1:]).ravel().tolist()
    except ValueError: similarity = [0] * len(jobs)
    results = []
    for index, (job, info) in enumerate(zip(jobs, parsed)):
        required, preferred = set(info['requiredSkills']), set(info['preferredSkills'])
        matching = required & owned
        documented = {s for s in matching if any(c in ('Supported by project', 'Supported by experience') for c in evidence[s]['categories'])}
        assessed = [interview[s] for s in required if s in interview]
        eligibility = None
        experience = preferences.get('experienceYears')
        if info['minExperienceYears'] is not None and experience is not None:
            eligibility = min(1, experience / max(1, info['minExperienceYears']))
        preference_matches = []
        location = str(preferences.get('location') or '').strip().lower()
        arrangement = preferences.get('arrangement', 'Any')
        if location: preference_matches.append(float(location in str(job.get('location', '')).lower()))
        job_arrangement = str(job.get('arrangement', '')).lower()
        if arrangement != 'Any' and job_arrangement and job_arrangement != 'unknown':
            preference_matches.append(float(arrangement.lower().replace('-', '') == job_arrangement.replace('-', '')))
        if eligibility is not None: preference_matches.append(eligibility)
        if preference_matches: eligibility = sum(preference_matches) / len(preference_matches)
        components = {'skillCoverage': (len(matching) / len(required)) if required else None,
                      'documentedEvidence': len(documented) / len(required) if required else None,
                      'interviewEvidence': sum(assessed) / len(assessed) if assessed else None,
                      'textRelevance': min(1, similarity[index] * 3), 'eligibilityPreferences': eligibility}
        weights = {'skillCoverage': .4, 'documentedEvidence': .2, 'interviewEvidence': .2,
                   'textRelevance': .1, 'eligibilityPreferences': .1}
        available = sum(weights[k] for k, v in components.items() if v is not None)
        score = round(100 * sum(weights[k] * v for k, v in components.items() if v is not None) / available) if available else 0
        missing = sorted(required - owned)
        results.append({'jobId': str(job.get('id', '')), 'score': max(0, min(100, score)),
                        'requiredSkills': info['requiredSkills'], 'preferredSkills': info['preferredSkills'],
                        'requirementsConfidence': info['requirementsConfidence'], 'level': info['level'],
                        'minExperienceYears': info['minExperienceYears'], 'experienceEvidence': info['experienceEvidence'],
                        'matchingSkills': sorted(matching), 'missingSkills': missing,
                        'missingPreferredSkills': sorted(preferred - owned),
                        'components': {k: {'value': round(v * 100, 1) if v is not None else None,
                                           'weight': round(weights[k] / available * 100, 1) if v is not None else 0} for k, v in components.items()},
                        'explanation': [f'{len(matching)}/{len(required)} description skills are documented in the resume.' if required else 'No known requirement skills were detected; skill coverage is unknown.',
                                        f'{len(documented)} matching skills have project or experience evidence; certifications are listed separately.',
                                        'Interview component uses only assessed skills.' if assessed else 'No relevant eligible interview evidence; available components were reweighted.',
                                        'Experience eligibility is unknown until professional years are explicitly supplied.' if experience is None else 'Experience comparison uses candidate-entered years, not inferred years.'],
                        'learningPath': [{'skill': skill, 'action': LEARNING.get(skill, f'Build and document a small project demonstrating {skill}; confirm the job requirement first.')} for skill in missing[:5]],
                        'gapNote': 'Not found in the supplied evidence does not mean the candidate lacks the skill.',
                        'scoreNote': 'Explainable relevance estimate, not a probability of hiring.'})
    return {'skills': list(evidence.values()), 'roles': roles, 'matches': sorted(results, key=lambda x: -x['score'])}


class MatchRequest(BaseModel):
    profile: dict
    fullText: str = Field(default='', max_length=150000)
    jobs: list[dict] = Field(max_length=1000)
    interviewScores: list[dict] = Field(default_factory=list)
    preferences: dict = Field(default_factory=dict)


class ParseJobsRequest(BaseModel):
    jobs: list[dict] = Field(min_length=1, max_length=100)


@router.post('/match')
def match_jobs(req: MatchRequest):
    return recommend(req.profile, req.fullText, req.jobs, req.interviewScores, req.preferences)


@router.post('/parse')
def parse_jobs(req: ParseJobsRequest):
    """Parse provider postings into required/preferred skills and an honest link label."""
    parsed = []
    for job in req.jobs:
        info = parse_job(job)
        info['link'] = classify_application_url(job.get('url'), job.get('applyUrl'))
        parsed.append(info)
    return {'jobs': parsed, 'linkLabels': LINK_LABELS}
