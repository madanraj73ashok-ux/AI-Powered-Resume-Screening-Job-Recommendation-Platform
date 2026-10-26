"""
Generate sample resume fixtures used by tests and demos.

Creates, from the synthetic "Walte Okune" resume content:
  docs/samples/walte-okune-resume.pdf
  docs/samples/walte-okune-resume.docx
  backend/src/tests/fixtures/walte-okune-resume.pdf (copy)
  backend/src/tests/fixtures/walte-okune-resume.docx (copy)
  backend/src/tests/fixtures/empty-image-only.pdf (no extractable text)
  backend/src/tests/fixtures/corrupt.pdf (invalid bytes)

Run:  .venv/Scripts/python.exe scripts/make_fixtures.py
All content is synthetic and clearly labelled as sample data.
"""

from __future__ import annotations

import io
import os
import shutil
from pathlib import Path

from docx import Document
from docx.shared import Pt

ROOT = Path(__file__).resolve().parents[2]  # repo root
SAMPLES = ROOT / "docs" / "samples"
FIXTURES = ROOT / "backend" / "src" / "tests" / "fixtures"

NAME = "Walte Okune"
TITLE = "Robotics Engineer"

LINES = [
    "Walte Okune",
    "Robotics Engineer",
    "",
    "Contact Details",
    "walteokune@email.com | (301) 765-4345 | 1234 Coolidge Ave, 11529, Illinois",
    "",
    "Summary",
    "Robotics Engineer with 5 years of experience in the design, development and "
    "implementation of autonomous robotic systems. Skilled in programming and "
    "debugging of robots using C++.",
    "",
    "Education",
    "Bachelor of Science in Robotics Engineering, Massachusetts Institute of "
    "Technology, 2017 - 2021",
    "",
    "Skills",
    "Robotics Engineering - Expert; Robotics Programming - Expert; Automation "
    "Systems - Expert; Machine Learning - Expert; Software Development - Expert; "
    "Control Systems - Expert; C++; Python",
    "",
    "Work Experience",
    "Robotics Engineer, Kuphal Inc, March 2023 - Present",
    "Developed and implemented innovative robotic systems to improve efficiency.",
    "Designed and tested robotic systems that met customer specifications and goals.",
    "Installed and repaired complex robotic systems to ensure optimal performance.",
    "",
    "Robotics Engineer, Lemke - Rice, March 2021 - March 2023",
    "Trained and supervised staff on the use of robotic equipment and programming.",
    "Collaborated with other engineers to design and prototype new robotic systems.",
    "Programmed and tested robotic systems for accuracy and precision using C++.",
    "",
    "References",
    "References available upon request.",
]


def make_docx_bytes() -> bytes:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    for line in LINES:
        if line in (NAME, TITLE):
            p = doc.add_paragraph()
            run = p.add_run(line)
            run.bold = True
            run.font.size = Pt(16 if line == NAME else 12)
        elif line and line in {
            "Contact Details", "Summary", "Education", "Skills",
            "Work Experience", "References",
        }:
            p = doc.add_paragraph()
            run = p.add_run(line)
            run.bold = True
            run.font.size = Pt(12)
        else:
            doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def make_pdf_bytes(lines: list[str]) -> bytes:
    """Hand-built minimal single-page PDF with Helvetica text (no deps)."""
    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    content_parts = ["BT", "/F1 10 Tf", "14 TL", "50 760 Td"]
    for line in lines:
        if not line:
            content_parts.append("0 -8 Td")
            continue
        content_parts.append(f"({esc(line[:200])}) Tj")
        content_parts.append("0 -14 Td")
    content_parts.append("ET")
    stream = "\n".join(content_parts).encode("latin-1", errors="replace")

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode())
        out.write(body)
        out.write(b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    )
    return out.getvalue()


def main() -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    FIXTURES.mkdir(parents=True, exist_ok=True)

    pdf = make_pdf_bytes(LINES)
    docx = make_docx_bytes()

    (SAMPLES / "walte-okune-resume.pdf").write_bytes(pdf)
    (SAMPLES / "walte-okune-resume.docx").write_bytes(docx)
    (SAMPLES / "README.md").write_text(
        "# Sample resumes (synthetic)\n\n"
        "All files here are **synthetic sample data** created for development and "
        "testing. They are not real people or real vacancies.\n\n"
        "- `walte-okune-resume.pdf` / `.docx` — text-based resume used for "
        "upload/extraction demos.\n"
        "- `walte-okune-resume.png` — an image of a resume layout (scanned-style); "
        "OCR is not configured, so this file cannot be parsed — kept to "
        "demonstrate the honest 'cannot extract' behaviour.\n",
        encoding="utf-8",
    )

    (FIXTURES / "walte-okune-resume.pdf").write_bytes(pdf)
    (FIXTURES / "walte-okune-resume.docx").write_bytes(docx)
    (FIXTURES / "corrupt.pdf").write_bytes(b"%PDF-1.4\nthis is not a valid pdf body")
    (FIXTURES / "empty-image-only.pdf").write_bytes(
        # valid PDF with a blank page (no text) — simulates an image-only scan
        make_pdf_bytes([])
    )
    print(f"Fixtures written to {SAMPLES} and {FIXTURES}")


if __name__ == "__main__":
    main()
