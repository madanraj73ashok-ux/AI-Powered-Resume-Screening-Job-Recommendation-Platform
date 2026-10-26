"""
VeriHire AI — local AI engine (FastAPI).

Internal service: binds to 127.0.0.1 only. Never expose this port publicly.
All processing is local (pdfplumber / python-docx / scikit-learn / rules).
No paid external AI APIs are used.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .analysis import analyze
from .extract import ExtractionError, extract_document
from .questions import DIFFICULTIES, generate_questions
from .scoring import evaluate_answer
from .skills import skill_categories

app = FastAPI(
    title="VeriHire Local AI Engine",
    version="1.0.0",
    description="Local resume extraction and analysis. No external AI calls.",
)

# Allow only the backend on localhost (internal service).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000", "http://127.0.0.1:4000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = int(os.environ.get("AI_MAX_UPLOAD_MB", "5")) * 1024 * 1024


class AnalyzeRequest(BaseModel):
    profile: dict
    fullText: str


class GenerateQuestionsRequest(BaseModel):
    profile: dict
    findings: list = []
    difficulty: str = "Intermediate"
    count: int = 8
    seed: str = ""


class EvaluateAnswerRequest(BaseModel):
    question: dict
    answer: str
    difficulty: str = "Intermediate"


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "verihire-ai-engine",
        "mode": "local-deterministic",
        "externalAiUsed": False,
    }


@app.get("/skills")
def skills() -> dict:
    return {"categories": skill_categories()}


@app.post("/extract")
async def extract(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="The file is too large.")
    try:
        result = extract_document(file.filename or "", data, file.content_type or "")
    except ExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@app.post("/analyze")
def analyze_endpoint(req: AnalyzeRequest) -> dict:
    if not req.fullText or not req.fullText.strip():
        raise HTTPException(status_code=422, detail="No resume text was provided.")
    return analyze(req.profile, req.fullText)


@app.get("/skill-dictionary")
def skill_dictionary() -> dict:
    return {"categories": skill_categories()}


@app.get("/interview/options")
def interview_options() -> dict:
    return {
        "difficulties": list(DIFFICULTIES),
        "defaultQuestionCount": 8,
        "generator": "curated question bank + deterministic personalization",
    }


@app.post("/generate-questions")
def generate(req: GenerateQuestionsRequest) -> dict:
    if not req.profile:
        raise HTTPException(status_code=422, detail="A resume profile is required.")
    if req.difficulty not in DIFFICULTIES:
        raise HTTPException(status_code=422, detail=f"Difficulty must be one of {list(DIFFICULTIES)}")
    if not (3 <= req.count <= 15):
        raise HTTPException(status_code=422, detail="Question count must be between 3 and 15.")
    return generate_questions(
        req.profile,
        findings=req.findings,
        difficulty=req.difficulty,
        count=req.count,
        seed=req.seed,
    )


@app.post("/evaluate-answer")
def evaluate(req: EvaluateAnswerRequest) -> dict:
    if not req.question or not req.question.get("expectedConcepts"):
        raise HTTPException(status_code=422, detail="A question with expected concepts is required.")
    if not req.answer or not req.answer.strip():
        raise HTTPException(status_code=422, detail="An answer is required.")
    return evaluate_answer(req.question, req.answer, req.difficulty)
