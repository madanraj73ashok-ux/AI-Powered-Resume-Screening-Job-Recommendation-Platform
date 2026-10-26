from app.extract import parse_profile
from app.analysis import analyze
from app.questions import generate_questions


def test_headings_and_name_initials_do_not_become_skills_or_projects():
    text = '''TEST CANDIDATE R
TECHNICAL SKILLS:
Programming: Python, Embedded C
Design: SolidWorks
ACADEMIC PROJECTS:
Robot vacuum cleaner
Developed a robot using Arduino and ultrasonic sensors.
INTERNSHIP & TRAINING:
Automation Intern
Implemented a sensor interface.
CERTIFICATIONS & ACHIEVEMENTS:
Completed a Python course.
'''
    profile = parse_profile([{'page': 1, 'text': text}])
    skills = {s['skill'] for s in profile['skills']}
    assert 'R' not in skills
    assert 'Embedded C' in skills and 'SolidWorks' in skills
    assert 'TECHNICAL SKILLS:' not in skills
    assert profile['projects'][0]['text'] == 'Robot vacuum cleaner'
    assert profile['experience'] and profile['responsibilities']
    assert profile['certifications'][0]['text'] == 'Completed a Python course.'


def test_explicit_r_programming_is_retained_after_removing_name_initial():
    profile = parse_profile([{'page': 1, 'text': 'TEST CANDIDATE R\nSKILLS\nPython, R, SQL'}])
    assert 'R' in {s['skill'] for s in profile['skills']}


def test_literal_education_fallback_and_achievement_questions():
    profile = parse_profile([{'page': 1, 'text': 'TEST CANDIDATE\nEDUCATION TECHNICAL SKILLS\nBachelor of Computer Applications\nPROJECT\nBuilt a chatbot with Python.\nACHIEVEMENTS\nWon an analytics challenge.'}])
    assert profile['education']
    assert profile['achievements'][0]['text'] == 'Won an analytics challenge.'
    generated = generate_questions(profile, count=10, interview_type='HR')
    assert any(q['type'] == 'achievement' for q in generated['questions'])


def test_single_project_mention_is_not_falsely_described_as_only_a_skills_list():
    profile = {'skills': [{'skill': 'NLP'}], 'projects': [{'text': 'Built a classifier using NLP.'}], 'experience': [], 'education': []}
    finding = next(f for f in analyze(profile, 'Built a classifier using NLP.')['findings'] if f['claim'] == 'Skill claim: NLP')
    assert finding['type'] == 'skill_with_evidence'
