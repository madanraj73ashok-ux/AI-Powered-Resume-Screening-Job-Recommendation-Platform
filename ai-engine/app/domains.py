"""Explainable domain signals from technical evidence, never personal attributes."""
import json
import re
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from .skills import normalize_skill

CATALOG = json.loads((Path(__file__).resolve().parents[1] / 'data/domains/catalog.json').read_text(encoding='utf-8'))
DOMAIN_IDS = tuple(CATALOG['domains'])
router = APIRouter(prefix='/domains')


def classify_domains(profile):
    # Some legacy profiles detected dictionary skills anywhere on the page,
    # including college names. Exclude those when their sole source excerpt
    # contains a personal/education field; explicit skill-list entries survive.
    excluded_sources = [str(x.get('text') or '').strip().lower() for x in profile.get('education') or []]
    excluded_sources += [str(profile.get('name') or '').strip().lower()]
    skills = set()
    for item in profile.get('skills') or []:
        evidence = item.get('evidence')
        quote = str(evidence.get('quote') or '').lower() if isinstance(evidence, dict) else ''
        if quote and any(source and source in quote for source in excluded_sources):
            continue
        skills.add(normalize_skill(str(item.get('skill') or '')))
    weighted = []
    for field, weight in [('projects', 3), ('experience', 3), ('responsibilities', 3), ('certifications', .5)]:
        weighted += [(str(item.get('text') or ''), weight, item.get('evidence')) for item in profile.get(field) or []]
    # Education, college names, name, contact, demographics and location are excluded.
    technical = ' '.join(str(x) for x in skills if x) + ' ' + ' '.join(text for text, _, _ in weighted)
    prototypes = [' '.join(data['skills'] + data['keywords']) for data in CATALOG['domains'].values()]
    try:
        vectors = TfidfVectorizer(stop_words='english').fit_transform([technical] + prototypes)
        similarities = cosine_similarity(vectors[0:1], vectors[1:]).ravel()
    except ValueError: similarities = [0] * len(prototypes)
    ranked = []
    for index, (key, data) in enumerate(CATALOG['domains'].items()):
        matched = sorted(set(data['skills']) & skills)
        snippets = []
        signal = len(matched) * 2
        for text, weight, evidence in weighted:
            hits = [word for word in data['keywords'] if re.search(r'\b' + re.escape(word) + r'\w*\b', text, re.I)]
            if hits:
                signal += min(3, len(hits)) * weight
                snippets.append({'excerpt': text[:240], 'source': evidence, 'keywords': hits[:4]})
        score = round(min(100, signal * 4 + float(similarities[index]) * 30), 1)
        ranked.append({'domain': key, 'label': data['label'], 'score': score, 'matchedSkills': matched,
                       'evidence': snippets[:4], 'reasons': [f'{len(matched)} taxonomy skills matched.',
                         f'{len(snippets)} project, role or certification excerpts matched.']})
    ranked.sort(key=lambda x: -x['score'])
    meaningful = [x for x in ranked if x['domain'] != 'general' and x['score'] >= 15]
    top = meaningful[:3]
    mixed = len(top) > 1 and top[1]['score'] >= .6 * top[0]['score']
    return {'version': CATALOG['version'], 'ranked': ranked,
            'suggestedDomains': [x['domain'] for x in (top[:2] if mixed else top[:1])] or ['general'],
            'uncertain': not top or top[0]['score'] < 30,
            'note': 'Scores are uncalibrated evidence signals, not probabilities. Confirm the domain before interviewing.'}


def domain_questions(confirmed, difficulty):
    questions = []
    for domain in dict.fromkeys(confirmed):
        data = CATALOG['domains'].get(domain)
        if not data: continue
        for q in data['questions']:
            if q['difficulty'] == difficulty:
                questions.append({'id': f"{CATALOG['version']}:{q['id']}", 'text': q['text'], 'type': 'fundamentals',
                  'difficulty': difficulty, 'domain': domain, 'skill': data['label'], 'sourceClaim': '',
                  'expectedConcepts': q['concepts'], 'maxMarks': {'Beginner': 8, 'Intermediate': 10, 'Advanced': 12}[difficulty],
                  'rubric': {'technicalAccuracy': '40%: Explain ' + ', '.join(q['concepts']) + ' accurately.',
                    'completeness': '25%: Address all parts of the question.', 'practicalExamples': '20%: Give a specific example.',
                    'understanding': '15%: Explain the reasoning, limitations and trade-offs.'}, 'followUpTemplates': [],
                  'bankVersion': CATALOG['version'], 'rubricVersion': CATALOG['rubricVersion'], 'isFollowUp': False})
    return questions


class DomainRequest(BaseModel):
    profile: dict


@router.post('/classify')
def classify(req: DomainRequest):
    return classify_domains(req.profile)


@router.get('/catalog')
def catalog():
    return {'version': CATALOG['version'], 'domains': [{'id': key, 'label': data['label']} for key, data in CATALOG['domains'].items()]}
