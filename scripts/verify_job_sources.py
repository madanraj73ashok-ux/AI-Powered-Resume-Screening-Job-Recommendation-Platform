"""Verify that every configured job-source board token returns real vacancies.

Usage (from the repository root):

    python scripts/verify_job_sources.py

Reads backend/src/config/jobSources.json and performs one polite request per
source to the provider's public job-board API. Prints the HTTP status, the
number of postings returned and one real job title per board. This is a
development diagnostic: it never writes to the database and it never invents
results — an unreachable or empty board is reported as FAIL.

Observed rate limits: Lever's robots.txt requests a 1 second crawl delay, so
requests are serialized with a short pause. Greenhouse publishes no read limit;
the same pause is applied for politeness.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "backend" / "src" / "config" / "jobSources.json"
USER_AGENT = "VeriHireAI-local-job-source-check/1.0 (student project; contact: local)"
PAUSE_SECONDS = 1.0


def board_url(provider: str, token: str) -> str:
    if provider == "greenhouse":
        return f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs"
    if provider == "lever":
        return f"https://api.lever.co/v0/postings/{token}?mode=json"
    raise ValueError(f"Unknown provider: {provider}")


def first_title(provider: str, payload) -> str:
    if provider == "greenhouse":
        jobs = payload.get("jobs") or []
        return jobs[0].get("title", "") if jobs else ""
    if provider == "lever":
        return payload[0].get("text", "") if payload else ""
    return ""


def count_jobs(provider: str, payload) -> int:
    if provider == "greenhouse":
        return len(payload.get("jobs") or [])
    if provider == "lever":
        return len(payload or [])
    return 0


def main() -> int:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    failures = 0
    for source in config["sources"]:
        provider, token = source["provider"], source["token"]
        label = f"{source.get('company', '?')} ({provider}:{token})"
        request = urllib.request.Request(board_url(provider, token), headers={"Accept": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            count = count_jobs(provider, payload)
            if count == 0:
                print(f"FAIL  {label}: returned 0 postings")
                failures += 1
            else:
                title = first_title(provider, payload)
                print(f"OK    {label}: {count} postings, first: {title!r}")
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError, TimeoutError) as exc:
            print(f"FAIL  {label}: {exc}")
            failures += 1
        time.sleep(PAUSE_SECONDS)
    print(f"\n{len(config['sources']) - failures}/{len(config['sources'])} sources returned real postings.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
