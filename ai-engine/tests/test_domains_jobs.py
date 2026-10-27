"""Synthetic regression fixtures for the domain and job-matching checkpoint."""
import pytest

from app.domains import classify_domains
from app.jobs import candidate_evidence, parse_job, recommend
from app.questions import generate_questions
from app.skills import detect_skills, normalize_skill


def test_normalization_distinguishes_tools_vendors_and_headings():
    assert normalize_skill('Tools Power BI') == 'Power BI'
    assert normalize_skill('Soft Skills Critical Thinking') == 'Critical Thinking'
    assert normalize_skill('INTERNSHIPS') is None
    detected = {s['skill'] for s in detect_skills('GitHub and Oracle Cloud OCI certification')}
    assert 'GitHub' in detected and 'Git' not in detected
    assert 'Oracle Database' not in detected


@pytest.mark.parametrize('expected,skills,project', [
    ('software_it', ['React', 'TypeScript', 'JavaScript'], 'Developed a web application with a backend API.'),
    ('robotics_automation', ['Arduino', 'PLC'], 'Built a robot with a motor driver and ultrasonic sensor integration.'),
    ('data_analytics', ['SQL', 'Power BI', 'DAX'], 'Built an analytics dashboard with data cleaning and visualization.'),
])
def test_domains_follow_technical_evidence(expected, skills, project):
    detected = classify_domains({'skills': [{'skill': s} for s in skills], 'projects': [{'text': project}]})
    assert detected['ranked'][0]['domain'] == expected
    assert expected in detected['suggestedDomains']
    assert detected['version']


def test_personal_details_and_education_do_not_change_domain_results():
    base = {'skills': [{'skill': 'PLC'}], 'projects': [{'text': 'Built a robot with ultrasonic sensors.'}]}
    altered = {**base, 'name': 'Software Expert', 'contact': {'location': 'Python City'},
               'education': [{'text': 'Computer Science at Web Application University'}]}
    assert classify_domains(base) == classify_domains(altered)


def test_legacy_skill_detected_only_in_college_name_is_not_used():
    profile = {'name': 'Example Candidate', 'education': [{'text': 'Python University of Robotics'}],
               'skills': [{'skill': 'Python', 'evidence': {'page': 1, 'quote': 'Python University of Robotics'}}]}
    result = classify_domains(profile)
    assert all(not item['matchedSkills'] for item in result['ranked'])
    assert result['suggestedDomains'] == ['general']


def test_confirmed_domains_preserve_mixed_coverage_without_duplicate_question_ids():
    result = generate_questions({'skills': []}, difficulty='Intermediate', count=8,
                                confirmed_domains=['robotics_automation', 'software_it', 'robotics_automation'])
    questions = result['questions']
    assert {q['domain'] for q in questions} == {'robotics_automation', 'software_it'}
    assert len({q['id'] for q in questions}) == len(questions)
    assert all(q['bankVersion'] and q['rubricVersion'] for q in questions)


def test_robotics_bank_does_not_insert_generic_software_questions():
    result = generate_questions({'skills': [{'skill': 'Python'}]}, difficulty='Beginner', count=8,
                                confirmed_domains=['robotics_automation'], interview_type='Technical')
    assert any(q.get('domain') == 'robotics_automation' for q in result['questions'])
    assert all(q.get('domain') in (None, 'robotics_automation') for q in result['questions'])
    assert not any('API' in q['text'] for q in result['questions'])


def test_confirmed_domain_can_include_relevant_claimed_skills_without_other_domain_skills():
    profile = {'skills': [{'skill': 'Arduino'}, {'skill': 'Python'}, {'skill': 'React'}]}
    result = generate_questions(profile, difficulty='Beginner', count=8,
                                confirmed_domains=['robotics_automation'], interview_type='Technical')
    text = ' '.join(q['text'] for q in result['questions'])
    assert 'Arduino' in text and 'Python' in text
    assert 'React' not in text
    assert len({q['id'] for q in result['questions']}) == len(result['questions'])


def test_certifications_do_not_count_as_hands_on_evidence():
    profile = {'skills': [{'skill': 'Python'}], 'certifications': [{'text': 'Python certificate'}]}
    result = recommend(profile, '', [{'id': 'synthetic', 'title': 'Developer', 'description': 'Requirements\nPython'}])
    assert result['matches'][0]['components']['documentedEvidence']['value'] == 0
    assert 'Supported by certification' in candidate_evidence(profile)['Python']['categories']


def test_missing_interview_evidence_reweights_and_keeps_unknown_experience_unknown():
    result = recommend({'skills': [{'skill': 'Python'}]}, '', [
        {'id': 'synthetic', 'title': 'Developer', 'description': 'Requirements\nPython and SQL\n3 years of experience'}])
    match = result['matches'][0]
    assert match['missingSkills'] == ['SQL']
    assert match['components']['interviewEvidence'] == {'value': None, 'weight': 0}
    assert match['components']['eligibilityPreferences'] == {'value': None, 'weight': 0}
    assert sum(c['weight'] for c in match['components'].values()) == pytest.approx(100, abs=.2)


def test_job_requirements_and_preferred_skills_remain_separate():
    parsed = parse_job({'title': 'Data Intern', 'description': '<h2>Requirements</h2><p>Python and SQL</p><h2>Preferred</h2><p>Power BI</p>'})
    assert parsed['requiredSkills'] == ['Python', 'SQL']
    assert parsed['preferredSkills'] == ['Power BI']
    assert parsed['level'] == 'Internship'
