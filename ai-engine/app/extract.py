"""
Local document extraction for PDF and DOCX resumes.

- PDF:  pdfplumber (text per page, page numbers preserved as evidence refs)
- DOCX: python-docx (paragraphs, sections preserved as evidence refs)

No external services. Scanned/image-only PDFs are detected and reported
honestly instead of inventing content (OCR is not configured by default).
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import PurePosixPath
from typing import List, Optional

import pdfplumber
from docx import Document

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{4})")
LINKEDIN_RE = re.compile(r"linkedin\.com/in/[a-zA-Z0-9._%-]+", re.IGNORECASE)
URL_RE = re.compile(r"https?://[^\s,;]+")
DATE_RANGE_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4})\s*[-–—]\s*"
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|Present|Current|\d{4})",
    re.IGNORECASE,
)

SECTION_KEYWORDS = {
    "summary": ["summary", "professional summary", "profile", "objective", "about"],
    "education": ["education", "academic background", "qualifications"],
    "skills": ["skills", "technical skills", "core competencies", "technologies"],
    "experience": ["work experience", "experience", "employment", "employment history", "work history", "internships", "internship & training"],
    "projects": ["project", "projects", "academic projects", "personal projects", "key projects", "project experience"],
    "certifications": ["certifications", "certificates", "licenses", "certifications & achievements"],
    "achievements": ["achievements", "accomplishments", "awards"],
    "references": ["references"],
    "other": ["volunteer", "volunteering", "career highlights"],
}


class ExtractionError(Exception):
    """Raised when a document cannot be parsed."""


MAX_DOCUMENT_TEXT = 1_000_000
MAX_PDF_PAGES = 100
MAX_DOCX_ENTRIES = 500
MAX_DOCX_UNCOMPRESSED = 20 * 1024 * 1024


def _validate_docx_archive(data: bytes) -> None:
    """Check ZIP structure and expansion before python-docx opens the package."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_DOCX_ENTRIES:
                raise ExtractionError('DOCX contains too many archive entries.')
            names = set()
            total = 0
            for entry in entries:
                name = entry.filename
                parts = PurePosixPath(name).parts
                if (not name or '\\' in name or name.startswith('/') or '..' in parts
                        or ':' in name or name in names or entry.flag_bits & 1):
                    raise ExtractionError('DOCX contains unsafe or encrypted archive entries.')
                names.add(name)
                if name.lower().endswith('vbaproject.bin'):
                    raise ExtractionError('Macro-enabled documents are not accepted.')
                total += entry.file_size
                if (entry.file_size > 10 * 1024 * 1024 or total > MAX_DOCX_UNCOMPRESSED
                        or (entry.file_size > 1024 * 1024 and entry.file_size > max(1, entry.compress_size) * 100)):
                    raise ExtractionError('DOCX archive exceeds safe expansion limits.')
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names:
                raise ExtractionError('DOCX package is missing required document parts.')
    except (zipfile.BadZipFile, OSError) as exc:
        raise ExtractionError('The DOCX archive is invalid.') from exc


def extract_pdf(data: bytes) -> List[dict]:
    """Return [{'page': int, 'text': str}] preserving page numbers."""
    try:
        pages: List[dict] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) == 0:
                raise ExtractionError("The PDF contains no pages.")
            if len(pdf.pages) > MAX_PDF_PAGES:
                raise ExtractionError("The PDF contains too many pages.")
            total_chars = 0
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                total_chars += len(text)
                if total_chars > MAX_DOCUMENT_TEXT:
                    raise ExtractionError("The document contains too much extracted text.")
                pages.append({"page": i, "text": text})
        return pages
    except ExtractionError:
        raise
    except Exception as exc:  # corrupt/encrypted pdf
        raise ExtractionError(f"Could not read the PDF file: {exc}") from exc


def extract_docx(data: bytes) -> List[dict]:
    """Return [{'page': 1, 'text': str}] for a DOCX (single logical page)."""
    try:
        _validate_docx_archive(data)
        doc = Document(io.BytesIO(data))
        paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
        text = "\n".join(paragraphs)
        if len(text) > MAX_DOCUMENT_TEXT:
            raise ExtractionError("The document contains too much extracted text.")
        return [{"page": 1, "text": text}]
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(f"Could not read the DOCX file: {exc}") from exc


def _section_ranges(lines: List[str]) -> dict:
    """Map section name -> (start_index, end_index) over non-empty lines."""
    starts = []
    for idx, raw in enumerate(lines):
        line = raw.strip().lower().rstrip(":")
        if not line or len(line) > 40:
            continue
        for name, keywords in SECTION_KEYWORDS.items():
            if line in keywords:
                starts.append((idx, name))
                break
    ranges = {}
    for i, (start, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(lines)
        if name not in ranges:  # keep the first occurrence
            ranges[name] = (start + 1, end)
    return ranges


def parse_profile(pages: List[dict]) -> dict:
    """
    Heuristic structured parse of resume text.
    Every extracted item carries an evidence reference {page, quote}.
    """
    full_text = "\n".join(p["text"] for p in pages)

    # Build a line index with page numbers for evidence references.
    lines: List[tuple] = []  # (line_text, page)
    for p in pages:
        for line in p["text"].splitlines():
            if line.strip():
                lines.append((line.strip(), p["page"]))
    flat = [l for l, _ in lines]

    errors: List[str] = []
    if not full_text.strip():
        errors.append(
            "No text could be extracted. The document may be an image-only scan; "
            "OCR is not configured in this installation."
        )

    # --- name: first line that looks like a person's name, else "Name:" pattern
    name = None
    name_evidence = None
    for text, page in lines[:8]:
        m = re.match(r"(?:name\s*:\s*)(.+)", text, re.IGNORECASE)
        candidate = m.group(1).strip() if m else text.strip()
        if 2 <= len(candidate) <= 60 and not EMAIL_RE.search(candidate) \
                and not re.search(r"[:@]|http|engineer|developer|analyst|resume|curriculum", candidate, re.IGNORECASE) \
                and len(candidate.split()) <= 5:
            name = candidate
            name_evidence = {"page": page, "quote": text[:120]}
            break

    # --- contact
    email_m = EMAIL_RE.search(full_text)
    phone_m = PHONE_RE.search(full_text)
    linkedin_m = LINKEDIN_RE.search(full_text)
    contact = {
        "email": email_m.group(0) if email_m else None,
        "phone": phone_m.group(0).strip() if phone_m else None,
        "linkedin": linkedin_m.group(0) if linkedin_m else None,
        "evidence": None,
    }
    if email_m:
        contact["evidence"] = {"page": _page_of(pages, email_m.group(0)), "quote": email_m.group(0)}

    ranges = _section_ranges(flat)

    def section_lines(name: str) -> List[tuple]:
        if name not in ranges:
            return []
        start, end = ranges[name]
        return lines[start:end]

    # --- summary
    summary_lines = section_lines("summary")
    summary = " ".join(l for l, _ in summary_lines[:6]) or None

    # --- education
    education = []
    for text, page in section_lines("education"):
        if re.search(r"bachelor|master|b\.?tech|m\.?tech|b\.?sc|m\.?sc|diploma|ph\.?d|associate|university|institute|college|school", text, re.I):
            dates = DATE_RANGE_RE.search(text)
            education.append(
                {
                    "text": text,
                    "degree": text,
                    "dates": dates.group(0) if dates else None,
                    "evidence": {"page": page, "quote": text[:160]},
                }
            )
    # Some two-column PDFs merge section headings. Recover literal degree lines
    # rather than declaring education absent; never synthesize an institution.
    if not education:
        for text, page in lines:
            if re.search(r"bachelor of|master of|diploma in|b\.?\s?tech\b", text, re.I):
                education.append({"text": text, "degree": text, "dates": None,
                                  "evidence": {"page": page, "quote": text[:160]}})

    # --- experience (lines with date ranges or title/company hints)
    experience = []
    for text, page in section_lines("experience"):
        dates = DATE_RANGE_RE.search(text)
        looks_role = re.search(
            r"engineer|developer|intern|analyst|manager|designer|consultant|assistant|specialist|lead|architect",
            text, re.I,
        )
        if dates or looks_role:
            experience.append(
                {
                    "text": text,
                    "dates": dates.group(0) if dates else None,
                    "evidence": {"page": page, "quote": text[:160]},
                }
            )

    # --- projects
    projects = []
    for text, page in section_lines("projects"):
        if len(text) < 8:
            continue
        projects.append({"text": text, "evidence": {"page": page, "quote": text[:160]}})

    # --- certifications
    certifications = []
    for text, page in section_lines("certifications"):
        if len(text) >= 4:
            certifications.append({"text": text, "evidence": {"page": page, "quote": text[:160]}})

    from .skills import detect_skills, normalize_skill

    # --- skills explicitly listed in the skills section (e.g. "Java - Expert; SQL")
    section_skills = []
    for text, page in section_lines("skills"):
        cleaned = re.sub(r"^(technical skills|soft skills|tools|programming|design)\s*:?\s*", "", text, flags=re.I)
        parts = re.split(r"[;·•,]", cleaned)
        for part in parts:
            part = part.strip(" -–—•\t")
            if not part:
                continue
            level_match = re.match(
                r"(.+?)\s*[-–—]\s*(Expert|Advanced|Intermediate|Beginner|Basic|Proficient|Master)\b",
                part,
                re.IGNORECASE,
            )
            level = None
            if level_match:
                level = level_match.group(2)
            skill_name = normalize_skill((level_match.group(1) if level_match else part).strip())
            if not skill_name or not (2 <= len(skill_name) <= 45):
                continue
            if re.match(r"(?i)^(skills|technical skills|core competencies)$", skill_name):
                continue
            section_skills.append(
                {
                    "skill": skill_name,
                    "category": "resume_skills_section",
                    "count": 1,
                    "level": level,
                    "evidence": {"page": page, "quote": text[:160]},
                }
            )

    # A single-letter name initial must not become a programming-language claim.
    skill_text = full_text.replace(name, " " * len(name)) if name else full_text
    detected = detect_skills(skill_text)
    # Scan pages separately so evidence keeps its actual page and exact source
    # text even when a candidate's name was masked for skill detection.
    page_evidence = {}
    for page in pages:
        original = page['text']
        masked = original.replace(name, ' ' * len(name)) if name else original
        for hit in detect_skills(masked):
            excerpt = hit.get('evidence') or ''
            offset = masked.find(excerpt)
            if offset >= 0:
                page_evidence.setdefault(hit['skill'], {'page': page['page'], 'quote': original[offset:offset + len(excerpt)][:160]})
    for d in detected:
        d["evidence"] = page_evidence.get(d['skill'])
    # merge: dictionary hits win; section skills add anything not already covered
    known = {d["skill"].lower(): d for d in detected}
    for s in section_skills:
        key = s['skill'].lower()
        if key not in known:
            detected.append(s)
            known[key] = s
        else:
            # An explicit skill-list mention is a more precise source than a
            # broad dictionary context which might overlap an education line.
            known[key]['evidence'] = s['evidence']

    return {
        "name": name,
        "nameEvidence": name_evidence,
        "contact": contact,
        "summary": summary,
        "skills": detected,
        "education": education,
        "experience": experience,
        "projects": projects,
        "certifications": certifications,
        "achievements": [{"text": text, "evidence": {"page": page, "quote": text[:160]}}
                         for text, page in section_lines("achievements") if len(text) >= 4],
        "responsibilities": [{"text": text, "evidence": {"page": page, "quote": text[:160]}}
                             for text, page in section_lines("experience")
                             if re.search(r"developed|built|conducted|managed|led|implemented|designed|responsible", text, re.I)],
        "extractionErrors": errors,
        "charCount": len(full_text),
    }


def _page_of(pages: List[dict], needle: str) -> int:
    for p in pages:
        if needle in p["text"]:
            return p["page"]
    return 1


def extract_document(filename: str, data: bytes, mime: str) -> dict:
    """Dispatch by extension, extract text and parse a structured profile."""
    name = (filename or "").lower()
    if name.endswith(".pdf") and data.startswith(b'%PDF-'):
        pages = extract_pdf(data)
    elif name.endswith(".docx") and data.startswith(b'PK\x03\x04'):
        pages = extract_docx(data)
    else:
        raise ExtractionError("Unsupported file type. Only PDF and DOCX files are accepted.")

    profile = parse_profile(pages)
    return {
        "pages": [{"page": p["page"], "chars": len(p["text"])} for p in pages],
        "fullText": "\n".join(p["text"] for p in pages),
        "profile": profile,
    }
