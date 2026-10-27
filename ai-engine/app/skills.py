"""
Local skill dictionary and matching helpers.

Everything here is deterministic and offline: no external AI services.
The dictionary maps canonical skill names to aliases seen in resumes.
"""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

# category -> canonical skill -> aliases (lowercase)
SKILL_DICTIONARY: Dict[str, Dict[str, List[str]]] = {
    "programming_languages": {
        "Python": ["python"],
        "JavaScript": ["javascript", "js", "es6"],
        "TypeScript": ["typescript", "ts"],
        "Java": ["java"],
        "C++": ["c++", "cpp", "c plus plus"],
        "C#": ["c#", "csharp", ".net"],
        "Go": ["golang"],
        "Rust": ["rust"],
        "Kotlin": ["kotlin"],
        "Swift": ["swift"],
        "SQL": ["sql"],
        "R": ["r language", "r programming"],
        "PHP": ["php"],
        "Ruby": ["ruby"],
        "Dart": ["dart"],
    },
    "frameworks": {
        "React": ["react", "react.js", "reactjs"],
        "Angular": ["angular"],
        "Vue.js": ["vue", "vue.js", "vuejs"],
        "Node.js": ["node.js", "nodejs", "node"],
        "Express": ["express", "express.js"],
        "Next.js": ["next.js", "nextjs"],
        "Django": ["django"],
        "Flask": ["flask"],
        "FastAPI": ["fastapi"],
        "Spring Boot": ["spring boot", "springboot"],
        "TensorFlow": ["tensorflow"],
        "PyTorch": ["pytorch"],
        "scikit-learn": ["scikit-learn", "sklearn", "scikit learn"],
        "Pandas": ["pandas"],
        "NumPy": ["numpy"],
        "Tailwind CSS": ["tailwind", "tailwindcss", "tailwind css"],
        "GraphQL": ["graphql"],
        "React Native": ["react native"],
        "Flutter": ["flutter"],
    },
    "databases": {
        "MongoDB": ["mongodb", "mongo"],
        "PostgreSQL": ["postgresql", "postgres"],
        "MySQL": ["mysql"],
        "SQLite": ["sqlite"],
        "Redis": ["redis"],
        "Elasticsearch": ["elasticsearch"],
        "Firebase": ["firebase"],
        "DynamoDB": ["dynamodb"],
        "Oracle Database": ["oracle database", "oracle db"],
        "SQL Server": ["sql server", "mssql"],
    },
    "cloud_devops": {
        "AWS": ["aws", "amazon web services"],
        "Azure": ["azure", "microsoft azure"],
        "Google Cloud": ["gcp", "google cloud"],
        "Docker": ["docker"],
        "Kubernetes": ["kubernetes", "k8s"],
        "CI/CD": ["ci/cd", "cicd", "continuous integration", "jenkins"],
        "Git": ["git"],
        "Oracle Cloud": ["oracle cloud", "oracle cloud infrastructure", "oci"],
        "Linux": ["linux", "ubuntu"],
        "Terraform": ["terraform"],
    },
    "ml_ai": {
        "Machine Learning": ["machine learning", "ml "],
        "Deep Learning": ["deep learning"],
        "NLP": ["nlp", "natural language processing"],
        "Computer Vision": ["computer vision", "opencv"],
        "Collaborative Filtering": ["collaborative filtering", "recommendation system", "recommender"],
        "Data Analysis": ["data analysis", "data analytics", "data analyst"],
        "Data Visualization": ["data visualization", "matplotlib", "seaborn"],
        "Prompt Engineering": ["prompt engineering"],
    },
    "concepts_practices": {
        "REST APIs": ["rest api", "restful", "rest apis"],
        "Agile": ["agile", "scrum"],
        "Microservices": ["microservices", "microservices architecture"],
        "System Design": ["system design", "system architecture", "architecture"],
        "OOP": ["object oriented", "oop", "object-oriented"],
        "Data Structures & Algorithms": ["data structures", "algorithms", "dsa"],
        "Unit Testing": ["unit testing", "jest", "pytest", "junit", "test-driven", "tdd"],
        "Git Workflows": ["git workflow", "branching strategy", "pull request"],
        "Problem Solving": ["problem solving", "debugging", "troubleshooting"],
    },
    "soft_skills": {
        "Critical Thinking": ["critical thinking"],
        "Adaptability": ["adaptability"],
        "Team Leadership": ["team lead", "led a team", "leadership", "mentored"],
        "Communication": ["communication", "presented", "stakeholder"],
        "Project Management": ["project management", "project manager", "sprint planning"],
    },
    "tools": {
        "GitHub": ["github"], "GitLab": ["gitlab"],
        "Power BI": ["power bi", "powerbi"], "Excel": ["excel", "microsoft excel"],
        "Jupyter Notebook": ["jupyter", "jupyter notebook"], "VS Code": ["vs code", "visual studio code"],
        "Tableau": ["tableau"], "DAX": ["dax"], "Power Query": ["power query"],
        "SolidWorks": ["solidworks"], "Arduino": ["arduino"], "PLC": ["plc", "ladder logic"],
        "Embedded C": ["embedded c"],
    },
}


def normalize_skill(value: str) -> str | None:
    value = re.sub(r'^(technical skills|soft skills|tools|programming|databases|frameworks)\s*:?\s*', '', value.strip(), flags=re.I)
    value = re.sub(r'\s+', ' ', value).strip(' :.;')
    if not value or value.lower() in {'skills', 'technical skills', 'internship', 'internships', 'projects', 'project', 'education', 'certifications', 'volunteer', 'volunteering', 'core competencies'}:
        return None
    for category in SKILL_DICTIONARY.values():
        for canonical, aliases in category.items():
            if value.lower() in {canonical.lower(), *aliases}:
                return canonical
    return value if 1 < len(value) < 60 else None

# Flat lookup: alias -> (canonical, category)
_ALIAS_INDEX: List[Tuple[str, str, str]] = []
for _category, _skills in SKILL_DICTIONARY.items():
    for _canonical, _aliases in _skills.items():
        _ALIAS_INDEX.append((_canonical.lower(), _category, _canonical))
        for _alias in _aliases:
            _ALIAS_INDEX.append((_alias.lower(), _category, _canonical))


def detect_skills(text: str) -> List[dict]:
    """
    Detect skills in free text. Returns list of
    {skill, category, count, evidence} with the first evidence snippet.
    """
    lowered = text.lower()
    results: List[dict] = []
    seen = set()
    for alias, category, canonical in _ALIAS_INDEX:
        if canonical in seen:
            continue
        pattern = re.compile(r"(?<![a-z0-9+#])" + re.escape(alias) + r"(?![a-z0-9+#])")
        matches = list(pattern.finditer(lowered))
        if not matches:
            continue
        first = matches[0]
        evidence = text[max(0, first.start() - 60) : first.end() + 60].strip()
        results.append(
            {"skill": canonical, "category": category, "count": len(matches), "evidence": evidence}
        )
        seen.add(canonical)
    return results


def skill_categories() -> Dict[str, List[str]]:
    return {cat: list(skills.keys()) for cat, skills in SKILL_DICTIONARY.items()}
