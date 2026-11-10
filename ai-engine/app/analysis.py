"""
Local, deterministic resume analysis.

Produces claim-level findings with: original claim, evidence quote, method,
finding, confidence (only when meaningful), reason, suggested follow-up
question and a reviewer status.

IMPORTANT: findings describe evidence in the resume, not external verification.
"""

from __future__ import annotations

import re
import uuid
from typing import List, Optional

from datetime import datetime

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

STATUS_READY = "Ready for Assessment"
STATUS_NEEDS_REVIEW = "Needs Review"
STATUS_EVIDENCE_REQUESTED = "Evidence Requested"
STATUS_INCOMPLETE = "Verification Incomplete"
STATUS_VERIFIED_RECORDED = "Supported by resume text"
STATUS_DISCREPANCY = "Discrepancies Require Review"

DATE_RANGE_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4})\s*[-–—]\s*"
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|Present|Current|\d{4})",
    re.IGNORECASE,
)
YEARS_CLAIM_RE = re.compile(r"(\d+)\+?\s+years?\s+(?:of\s+)?experience", re.IGNORECASE)


def _parse_date(token: str, present_year: int) -> Optional[tuple]:
    token = token.strip()
    if token.lower() in ("present", "current"):
        return (present_year, 12)
    m = re.match(r"([A-Za-z]{3,9})\.?\s+(\d{4})", token)
    if m:
        month = MONTHS.get(m.group(1)[:3].lower())
        if month:
            return (int(m.group(2)), month)
    if re.fullmatch(r"\d{4}", token):
        return (int(token), 1)
    return None


def _finding(**kwargs) -> dict:
    base = {
        "id": f"F{uuid.uuid4().hex[:8]}",
        "confidence": None,
        "severity": "info",
        "status": STATUS_NEEDS_REVIEW,
    }
    base.update(kwargs)
    return base


def analyze(profile: dict, full_text: str) -> dict:
    """Analyze a parsed resume profile and its full text."""
    findings: List[dict] = []
    present_year = datetime.now().year

    contact = profile.get("contact") or {}
    skills = profile.get("skills") or []
    skill_names = {s["skill"] for s in skills}
    experience = profile.get("experience") or []
    projects = profile.get("projects") or []
    responsibilities = profile.get("responsibilities") or []
    certifications = profile.get("certifications") or []
    education = profile.get("education") or []
    lowered = full_text.lower()

    # 1) Missing contact information ------------------------------------------
    if not contact.get("email"):
        findings.append(_finding(
            type="missing_email",
            claim="Contact email address",
            evidence=None,
            method="regex contact extraction",
            finding="No email address was found in the resume.",
            reason="Recruiters normally need an email address to respond.",
            suggestedFollowUp="Could you confirm the email address you would like employers to use?",
            status=STATUS_EVIDENCE_REQUESTED,
            severity="warning",
        ))
    if not contact.get("phone"):
        findings.append(_finding(
            type="missing_phone",
            claim="Contact phone number",
            evidence=None,
            method="regex contact extraction",
            finding="No phone number was found in the resume.",
            reason="A phone number helps recruiters schedule interviews quickly.",
            suggestedFollowUp="Could you provide a phone number for interview scheduling?",
            status=STATUS_EVIDENCE_REQUESTED,
            severity="info",
        ))

    # 2) Missing sections ------------------------------------------------------
    if not projects:
        findings.append(_finding(
            type="missing_projects",
            claim="Projects section",
            evidence=None,
            method="section detection",
            finding="No projects section was detected in the resume.",
            reason="Projects provide concrete evidence of practical skills.",
            suggestedFollowUp="Can you describe one personal, academic or work project in detail?",
            status=STATUS_NEEDS_REVIEW,
        ))
    if not education:
        findings.append(_finding(
            type="missing_education",
            claim="Education section",
            evidence=None,
            method="section detection",
            finding="No education entries were detected.",
            reason="Education details help verify the candidate's background.",
            suggestedFollowUp="Which degree or certification is most relevant to the roles you want?",
            status=STATUS_NEEDS_REVIEW,
        ))

    # 3) Skills claimed in the skills section but never evidenced elsewhere ----
    for s in skills:
        skill = s["skill"]
        alias_pattern = re.compile(r"(?<![a-z0-9+#])" + re.escape(skill.lower().split(" (")[0]) + r"(?![a-z0-9+#])")
        occurrences = [m.start() for m in alias_pattern.finditer(lowered)]
        # evidence beyond the skills section line itself:
        outside = 0
        for pos in occurrences:
            window = lowered[max(0, pos - 80): pos + 80]
            if "expert" not in window or window.count(skill.lower()) > 1:
                outside += 1
        references = []
        for section, label in ((projects, 'Project-supported'), (experience + responsibilities, 'Experience-supported'),
                               (certifications, 'Certification mentioned')):
            for item in section:
                if alias_pattern.search(str(item.get('text', '')).lower()):
                    references.append({'kind': label, 'evidence': item.get('evidence'), 'excerpt': str(item.get('text', ''))[:160]})
        contextual = any(ref['kind'] != 'Certification mentioned' for ref in references)
        if len(occurrences) <= 1 and not contextual:
            findings.append(_finding(
                type="skill_without_context",
                claim=f"Skill claim: {skill}",
                evidence=s.get("evidence"),
                evidenceCategories=['Mentioned'] + list(dict.fromkeys(ref['kind'] for ref in references)),
                supportingEvidence=references,
                method="dictionary match with context check",
                finding=f"'{skill}' has at most one direct mention and needs clearer supporting evidence.",
                reason="No matching project or role context was detected. This can be a parsing limitation; review the source document.",
                suggestedFollowUp=f"Where and how have you used {skill}? Please describe a concrete example.",
                status=STATUS_EVIDENCE_REQUESTED,
                severity="warning",
            ))
        else:
            findings.append(_finding(
                type="skill_with_evidence",
                claim=f"Skill claim: {skill}",
                evidence=(references[0].get('evidence') or s.get('evidence')) if references else s.get('evidence'),
                evidenceCategories=['Mentioned'] + list(dict.fromkeys(ref['kind'] for ref in references)),
                supportingEvidence=references,
                method="dictionary match with context check",
                finding=f"'{skill}' is supported by {len(occurrences)} mentions in the resume text.",
                reason="A project/role mention or repeated text supports this claim within the document only, not by external verification.",
                suggestedFollowUp=f"Which aspect of {skill} are you strongest in?",
                status=STATUS_VERIFIED_RECORDED,
                severity="info",
                confidence=round(min(0.9, 0.4 + 0.1 * len(occurrences)), 2),
            ))

    # 4) Employment date checks ------------------------------------------------
    ranges = []
    for e in experience:
        m = DATE_RANGE_RE.search(e.get("text", ""))
        if not m:
            continue
        start = _parse_date(m.group(1), present_year)
        end = _parse_date(m.group(2), present_year)
        if start and end and end >= start:
            ranges.append((start, end, e))
        elif start and end:
            findings.append(_finding(
                type="date_order",
                claim=e.get("text", "")[:80],
                evidence=e.get("evidence"),
                method="date range parsing",
                finding="End date occurs before the start date.",
                reason="Date ranges should run from earlier to later.",
                suggestedFollowUp="Could you double-check the dates for this role?",
                status=STATUS_DISCREPANCY,
                severity="warning",
            ))

    # overlapping roles
    for i in range(len(ranges)):
        for j in range(i + 1, len(ranges)):
            a_start, a_end, a_ev = ranges[i]
            b_start, b_end, b_ev = ranges[j]
            # strict interior overlap only: back-to-back roles are not flagged
            if a_start < b_start < a_end or b_start < a_start < b_end:
                findings.append(_finding(
                    type="date_overlap",
                    claim=f"{a_ev.get('text', '')[:60]} overlapping {b_ev.get('text', '')[:60]}",
                    evidence=a_ev.get("evidence"),
                    method="date range overlap detection",
                    finding="Two roles have overlapping date ranges.",
                    reason="Overlaps are possible (part-time, parallel roles) but should be confirmed.",
                    suggestedFollowUp="Were these roles held in parallel? If so, how did you split your time?",
                    status=STATUS_NEEDS_REVIEW,
                    severity="info",
                ))

    # 5) "X years of experience" consistency ---------------------------------
    claim_m = YEARS_CLAIM_RE.search(full_text)
    if claim_m and ranges:
        claimed = int(claim_m.group(1))
        earliest = min(r[0] for r in ranges)
        latest = max(r[1] for r in ranges)
        computed = (latest[0] - earliest[0]) + (latest[1] - earliest[1]) / 12
        if claimed > computed + 1.5:
            findings.append(_finding(
                type="years_mismatch",
                claim=claim_m.group(0),
                evidence={"page": 1, "quote": claim_m.group(0)},
                method="claim extraction vs. date arithmetic",
                finding=(
                    f"The resume claims {claimed} years of experience, but the listed "
                    f"roles span about {computed:.1f} years."
                ),
                reason="A gap between the claimed total and the listed timeline is worth clarifying.",
                suggestedFollowUp="Does the claimed experience include internships, freelance or academic work not listed here?",
                status=STATUS_NEEDS_REVIEW,
                severity="warning",
                confidence=0.7 if len(ranges) >= 2 else None,
            ))

    # 6) Similar project descriptions (TF-IDF cosine) --------------------------
    texts = [p.get("text", "") for p in projects]
    if len(texts) >= 2:
        try:
            matrix = TfidfVectorizer(stop_words="english").fit_transform(texts)
            sim = linear_kernel(matrix, matrix)
            for i in range(len(texts)):
                for j in range(i + 1, len(texts)):
                    score = float(sim[i][j])
                    if score >= 0.6:
                        findings.append(_finding(
                            type="similar_projects",
                            claim=f"{texts[i][:60]} / {texts[j][:60]}",
                            evidence=projects[i].get("evidence"),
                            method=f"TF-IDF cosine similarity = {score:.2f}",
                            finding="Two project descriptions are highly similar to each other.",
                            reason="Near-identical descriptions may be copy-paste or template text.",
                            suggestedFollowUp="How did these two projects differ in your actual contribution?",
                            status=STATUS_NEEDS_REVIEW,
                            severity="warning",
                            confidence=round(score, 2),
                        ))
        except ValueError:
            pass  # empty vocabulary; nothing to compare

    # overall status
    if not findings:
        overall = STATUS_READY
    elif any(f["status"] == STATUS_DISCREPANCY for f in findings):
        overall = STATUS_DISCREPANCY
    elif any(f["severity"] == "warning" for f in findings):
        overall = STATUS_NEEDS_REVIEW
    else:
        overall = STATUS_READY

    summary = {
        "overallStatus": overall,
        "skillsClaimed": len(skill_names),
        "findingsCount": len(findings),
        "warnings": sum(1 for f in findings if f["severity"] == "warning"),
        "supportedClaims": sum(1 for f in findings if f["status"] == STATUS_VERIFIED_RECORDED),
        "evidenceRequested": sum(1 for f in findings if f["status"] == STATUS_EVIDENCE_REQUESTED),
        "note": (
            "These findings are produced by local deterministic analysis of the resume "
            "document only. Supported claims are not independently confirmed. "
            "No external verification services were used."
        ),
    }
    return {"summary": summary, "findings": findings}
