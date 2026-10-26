"""Tests for the local AI engine (extraction, skills, analysis)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.extract import ExtractionError, extract_document, parse_profile, extract_pdf
from app.main import app
from app.skills import detect_skills
from app.analysis import analyze

client = TestClient(app)

FIXTURES = Path(__file__).resolve().parents[2] / "backend" / "src" / "tests" / "fixtures"
SAMPLE_PDF = FIXTURES / "walte-okune-resume.pdf"
SAMPLE_DOCX = FIXTURES / "walte-okune-resume.docx"
CORRUPT_PDF = FIXTURES / "corrupt.pdf"
EMPTY_PDF = FIXTURES / "empty-image-only.pdf"


@pytest.fixture(scope="module", autouse=True)
def require_fixtures():
    if not SAMPLE_PDF.exists() or not SAMPLE_DOCX.exists():
        pytest.skip("Run scripts/make_fixtures.py first")


# ---------------------------------------------------------------- skills

def test_detect_skills_finds_known_technologies():
    text = "Built REST APIs with Python and FastAPI, deployed on AWS with Docker."
    found = {s["skill"] for s in detect_skills(text)}
    assert {"Python", "FastAPI", "AWS", "Docker", "REST APIs"} <= found


def test_detect_skills_ignores_absent_technologies():
    found = {s["skill"] for s in detect_skills("I enjoy chess and hiking on weekends.")}
    assert "Kubernetes" not in found


# ---------------------------------------------------------------- extraction

def test_extract_pdf_returns_pages_and_text():
    data = SAMPLE_PDF.read_bytes()
    result = extract_document("resume.pdf", data, "application/pdf")
    assert result["fullText"].strip()
    assert "Walte Okune" in result["fullText"]
    assert result["pages"][0]["chars"] > 0


def test_extract_docx_returns_text():
    data = SAMPLE_DOCX.read_bytes()
    result = extract_document(
        "resume.docx",
        data,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert "Walte Okune" in result["fullText"]


def test_profile_parse_extracts_name_contact_skills_education_experience():
    data = SAMPLE_PDF.read_bytes()
    result = extract_document("resume.pdf", data, "application/pdf")
    profile = result["profile"]
    assert profile["name"] is not None and "Walte" in profile["name"]
    assert profile["contact"]["email"] == "walteokune@email.com"
    assert "765" in (profile["contact"]["phone"] or "")
    assert len(profile["skills"]) >= 6
    assert any("Robotics" in e["text"] or "Massachusetts" in e["text"] for e in profile["education"])
    assert len(profile["experience"]) >= 2
    for item in profile["skills"]:
        assert "evidence" in item


def test_corrupt_pdf_raises_extraction_error():
    with pytest.raises(ExtractionError):
        extract_document("corrupt.pdf", CORRUPT_PDF.read_bytes(), "application/pdf")


def test_unsupported_extension_raises():
    with pytest.raises(ExtractionError):
        extract_document("resume.txt", b"hello", "text/plain")


def test_image_only_pdf_reports_no_text():
    result = extract_document("scan.pdf", EMPTY_PDF.read_bytes(), "application/pdf")
    assert result["fullText"].strip() == ""
    assert any("OCR" in e for e in result["profile"]["extractionErrors"])


# ---------------------------------------------------------------- analysis

def test_analysis_finds_missing_email():
    profile = {"contact": {}, "skills": [], "experience": [], "projects": [], "education": []}
    result = analyze(profile, "Some resume text without contacts.")
    types = {f["type"] for f in result["findings"]}
    assert "missing_email" in types
    for f in result["findings"]:
        assert {"claim", "method", "finding", "reason", "suggestedFollowUp", "status"} <= set(f)


def test_analysis_full_sample_profile():
    data = SAMPLE_PDF.read_bytes()
    result = extract_document("resume.pdf", data, "application/pdf")
    analysis = analyze(result["profile"], result["fullText"])
    assert analysis["summary"]["overallStatus"] in {
        "Ready for Assessment",
        "Needs Review",
        "Discrepancies Require Review",
    }
    types = {f["type"] for f in analysis["findings"]}
    # the sample has no projects section and skills that need context
    assert "missing_projects" in types
    # consecutive roles (Mar 2021-Mar 2023, Mar 2023-Present) must NOT overlap
    assert "date_overlap" not in types


def test_analysis_flags_years_claim_mismatch():
    profile = {
        "contact": {"email": "a@b.com"},
        "skills": [],
        "education": [],
        "projects": [],
        "experience": [
            {"text": "Software Engineer, Acme Corp, Jan 2022 - Jan 2024", "evidence": None},
            {"text": "Developer, Beta LLC, Feb 2024 - Feb 2025", "evidence": None},
        ],
    }
    text = (
        "Senior engineer with 12 years of experience building distributed systems. "
        "Software Engineer, Acme Corp, Jan 2022 - Jan 2024. "
        "Developer, Beta LLC, Feb 2024 - Feb 2025."
    )
    result = analyze(profile, text)
    types = {f["type"] for f in result["findings"]}
    assert "years_mismatch" in types


def test_analysis_detects_similar_project_texts():
    profile = {
        "contact": {"email": "a@b.com"},
        "skills": [{"skill": "Python", "evidence": None}],
        "experience": [],
        "education": [],
        "projects": [
            {"text": "Built a recommendation engine using collaborative filtering and python"},
            {"text": "Built a recommendation engine using collaborative filtering and python"},
        ],
    }
    result = analyze(profile, "Built a recommendation engine using collaborative filtering")
    types = {f["type"] for f in result["findings"]}
    assert "similar_projects" in types


# ---------------------------------------------------------------- HTTP API

def test_health_endpoint():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["externalAiUsed"] is False


def test_http_extract_pdf():
    with SAMPLE_PDF.open("rb") as fh:
        res = client.post("/extract", files={"file": ("resume.pdf", fh, "application/pdf")})
    assert res.status_code == 200
    body = res.json()
    assert "Walte" in body["fullText"]
    assert body["profile"]["contact"]["email"] == "walteokune@email.com"


def test_http_extract_rejects_unsupported_type():
    res = client.post("/extract", files={"file": ("resume.txt", b"plain text", "text/plain")})
    assert res.status_code == 422


def test_http_analyze():
    with SAMPLE_PDF.open("rb") as fh:
        extracted = client.post(
            "/extract", files={"file": ("resume.pdf", fh, "application/pdf")}
        ).json()
    res = client.post(
        "/analyze", json={"profile": extracted["profile"], "fullText": extracted["fullText"]}
    )
    assert res.status_code == 200
    assert "findings" in res.json()
