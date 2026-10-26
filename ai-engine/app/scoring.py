"""
Answer scoring with question-specific rubrics.

Combines:
  - expected-concept coverage (keyword/phrase matching with synonyms)
  - TF-IDF cosine similarity as *supporting* evidence (never the sole basis)
  - evidence of concrete examples
  - evidence of reasoning about trade-offs

No personality, honesty or intelligence inference. A short or weak answer is
only ever described as "insufficient technical evidence in this answer".
"""

from __future__ import annotations

import re
from typing import List

from sklearn.feature_extraction.text import TfidfVectorizer

SYNONYMS = {
    "mutability": ["mutable", "immutable", "change", "modify"],
    "list": ["list", "array"],
    "tuple": ["tuple"],
    "performance": [
        "performance", "fast", "faster", "speed", "efficient", "efficiency",
        "benchmark", "benchmarked", "optimiz", "memory usage", "latency",
    ],
    "use case": ["use case", "when", "scenario", "situation"],
    "memory": ["memory", "ram", "footprint"],
    "lazy evaluation": ["lazy", "on demand", "on-demand"],
    "yield": ["yield", "generator"],
    "trade-offs": ["trade-off", "tradeoff", "trade off", "compromise", "cost"],
    "tradeoffs": ["trade-off", "tradeoff", "compromise", "cost"],
    "index": ["index", "indexes", "indexing", "b-tree"],
    "indexes": ["index", "indexing"],
    "logs": ["log", "logs", "logging", "log output"],
    "monitoring": ["monitor", "monitoring", "metrics", "alert", "alerts", "observability"],
    "testing": ["test", "tests", "testing", "unit test", "verified"],
    "evaluation": ["evaluate", "evaluation", "measure", "measured", "metric", "metrics"],
    "example": ["example", "for instance", "e.g.", "such as", "in one project"],
    "personal contribution": ["i built", "i wrote", "i implemented", "my contribution", "i designed", "i was responsible"],
    "outcome": ["result", "results", "outcome", "impact", "improved", "reduced", "increased"],
    "problem": ["problem", "issue", "pain point", "goal", "needed"],
    "users": ["user", "users", "customer", "customers", "audience", "team"],
    "reproduce": ["reproduce", "reproduced", "replicate", "recreate"],
    "logs": ["log", "logs", "logging", "stack trace", "trace"],
    "environment difference": ["environment", "staging", "production", "config", "configuration"],
    "rollback": ["rollback", "roll back", "revert", "revert the change"],
    "overfitting": ["overfit", "overfitting", "generaliz", "memoriz"],
    "regularization": ["regularization", "regularize", "dropout", "penalty"],
    "cross-validation": ["cross-validation", "cross validation", "k-fold", "cv"],
    "validation set": ["validation", "holdout", "hold-out", "test set"],
    "precision": ["precision"],
    "recall": ["recall"],
    "f1": ["f1", "f-score", "f score"],
    "class imbalance": ["imbalance", "imbalanced", "minority class"],
    "index": ["index", "indexes", "b-tree", "indexing"],
    "collection scan": ["collection scan", "full scan", "collscan"],
    "query shape": ["query shape", "filter", "sort", "projection", "query pattern"],
    "embedding": ["embed", "embedded", "embedding"],
    "referencing": ["reference", "referencing", "foreign id", "lookup"],
    "middleware": ["middleware", "middlewares"],
    "next": ["next()", "next", "chain"],
    "request pipeline": ["pipeline", "request flow", "chain", "order"],
    "event loop": ["event loop", "event-loop"],
    "call stack": ["call stack", "stack"],
    "promises": ["promise", "promises", "async/await", "async await"],
    "immutability": ["immutable", "immutability", "do not mutate", "copy"],
    "re-render": ["re-render", "rerender", "render again", "renders"],
    "memoization": ["memo", "memoization", "memoized", "usememo", "usecallback"],
    "fine-tune": ["fine-tune", "fine tune", "finetune"],
    "tokenization": ["tokeniz", "token ", "tokens", "splitting text"],
    "feature engineering": ["feature", "features", "feature engineering"],
    "tf-idf": ["tf-idf", "tfidf", "term frequency"],
    "tokenization": ["tokeniz", "tokens", "word split"],
    "diagnosis": ["diagnose", "diagnosis", "root cause", "investigate"],
    "resilience": ["resilien", "retry", "fallback", "recover", "timeout"],
    "scaling": ["scale", "scaling", "horizontal", "vertical", "load"],
    "bottleneck": ["bottleneck", "slow", "limiting"],
    "caching": ["cache", "caching", "redis", "memoize"],
    "architecture": ["architecture", "architectural", "design", "component", "service"],
    # Generic template concepts. These appear in skill-application, project,
    # experience and verification questions, so a genuine answer phrased in
    # ordinary engineering language must be able to hit them.
    "application": [
        "apply", "applied", "applying", "used it", "used", "using", "built",
        "implemented", "deployed", "integrated", "shipped", "in production",
        "at work", "in my last role", "in my project", "rolled out",
    ],
    "alternatives": [
        "alternative", "alternatives", "instead", "rather than", "compared",
        "comparison", "considered", "option", "options", "versus", "chose",
        "choosing", "trade-off", "tradeoff", "because",
    ],
    "outcome": [
        "result", "results", "outcome", "impact", "improved", "reduced",
        "increased", "saved", "handled", "enabled", "delivered", "achieved",
        "proved", "proven", "metric", "metrics", "so we could", "which let",
    ],
    "example": [
        "example", "for instance", "e.g.", "such as", "in one project",
        "in my last role", "in my project", "at work", "i built", "i wrote",
        "i implemented", "i designed", "specifically",
    ],
    "usage": ["use", "used", "using", "usage", "apply", "applied", "in practice"],
    "definition": [
        "is a", "is an", "defined as", "definition", "means", "refers to",
        "basically", "essentially",
    ],
    "scope": [
        "scope", "size", "scale", "number of", "team of", "users", "weeks",
        "months", "duration",
    ],
    "specifics": ["specific", "specifically", "exact", "detail", "details", "particular"],
    "decisions": ["decision", "decided", "chose", "choice", "why", "because"],
    "ownership": [
        "owned", "own", "responsible", "led", "my part", "i built", "i wrote",
        "i was responsible",
    ],
    "results": ["result", "results", "measured", "showed", "outcome", "numbers", "percentage"],
    "validation": ["validated", "validate", "verification", "tested", "checked", "held-out"],
    "challenge": ["challenge", "difficult", "hard part", "obstacle", "problem"],
    "approach": ["approach", "method", "strategy", "steps", "how i"],
    "learning": ["learned", "learning", "lesson", "takeaway", "do differently"],
    "context": ["context", "because", "situation", "background", "when"],
    "difference": ["difference", "differ", "different", "unlike", "versus", "compared"],
    "timeline": ["timeline", "dates", "months", "years", "period", "between"],
    "additional work": ["additional", "volunteer", "freelance", "internship", "extra"],
    "clarity": ["clarity", "clear", "explicit", "explain", "describe"],
    "accuracy": ["accuracy", "accurate", "correct", "precise"],
    "balance": ["balance", "manage", "juggle", "split time", "both roles"],
    "responsibilities": ["responsible", "duties", "tasks", "owned", "role"],
    "time management": ["prioritise", "prioritize", "schedule", "deadline", "planning"],
    "relevance": ["relevant", "relevance", "related", "applies", "useful"],
    "coursework": ["course", "coursework", "module", "subject", "class"],
    "motivation": ["motivation", "interested", "passionate", "drawn to", "why i"],
    "observability": ["observability", "monitoring", "metrics", "traces", "dashboard"],
    "sampling": ["sampling", "sample", "subset"],
    "feature flags": ["feature flag", "feature toggle", "toggle", "canary"],
    "traces": ["trace", "tracing", "span", "distributed trace"],
    "canary": ["canary", "gradual rollout", "small percentage", "percentage of traffic"],
    "goals": ["goal", "target", "objective", "aim"],
    "constraints": ["constraint", "limitation", "budget", "deadline", "restriction"],
    "documentation": ["documentation", "documented", "readme", "docs"],
    "security": ["security", "authentication", "authorization", "encryption", "vulnerability"],
    "implementation": ["implement", "implemented", "built", "wrote", "coded", "developed"],
    "design": ["design", "designed", "architecture", "structure"],
    "analysis": ["analysis", "analyse", "analyze", "analysed", "analyzed", "investigated"],
    "quality": ["quality", "clean", "maintainable", "reliable", "robust"],
    "reliability": ["reliable", "reliability", "resilient", "failover", "uptime"],
    "communication": ["communicated", "explained", "presented", "wrote up", "shared"],
    "collaboration": ["collaborated", "worked with", "cross-functional", "paired"],
    "debugging": ["debug", "debugging", "debugged", "diagnosed", "root cause"],
    "versioning": ["version", "versioned", "versioning", "tag", "tagged", "release"],
}

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
    "are", "was", "were", "it", "this", "that", "i", "we", "you", "my", "our",
}

EXAMPLE_MARKERS = [
    "for example", "for instance", "e.g.", "such as", "in one project",
    "at work", "i built", "i implemented", "in my project", "specifically",
]
REASONING_MARKERS = [
    "because", "so that", "reason", "trade-off", "tradeoff", "instead",
    "why", "therefore", "however", "advantage", "disadvantage", "decided",
]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _contains(haystack: str, needle: str) -> bool:
    """Whole-word-ish containment that tolerates plurals and morphology."""
    needle = needle.lower().strip()
    if not needle:
        return False
    pattern = r"(?<![a-z0-9])" + re.escape(needle) + r"[a-z]{0,3}(?![a-z0-9])"
    return re.search(pattern, haystack) is not None


def _concept_hit(concept: str, answer: str) -> bool:
    concept = concept.lower().strip()
    if _contains(answer, concept):
        return True
    for variant in SYNONYMS.get(concept, []):
        if _contains(answer, variant):
            return True
    # Morphological fallback: compare against the concept's stem so that
    # "implementation" also credits "implemented", and "understanding" credits
    # "understand". Cheap, deterministic, and language-agnostic enough.
    stem = re.sub(r"(ation|ition|ment|ness|ity|ance|ence|ing|ed|s)$", "", concept)
    if len(stem) >= 5 and _contains(answer, stem):
        return True

    # Evidence-based fallbacks for concepts that are demonstrated by the shape
    # of a real answer rather than by its vocabulary.
    if concept == "example" and any(m in answer for m in EXAMPLE_MARKERS):
        return True
    if concept == "outcome" and re.search(r"\b\d+\b", answer):
        # A stated number (latency, throughput, users, percentage) is an outcome.
        return True
    # token coverage for multi-word concepts (at least half the words)
    words = [w for w in re.findall(r"[a-z0-9\-]+", concept) if w not in STOPWORDS]
    if len(words) >= 2:
        hits = sum(1 for w in words if _contains(answer, w))
        return hits >= max(1, len(words) - 1)
    return False


def _similarity(answer: str, reference: str) -> float:
    try:
        vectors = TfidfVectorizer(stop_words="english").fit_transform([answer, reference])
        # cosine similarity between the two documents
        from sklearn.metrics.pairwise import cosine_similarity

        return float(cosine_similarity(vectors[0:1], vectors[1:2])[0][0])
    except ValueError:
        return 0.0


def evaluate_answer(
    question: dict,
    answer: str,
    difficulty: str = "Intermediate",
) -> dict:
    """Score one answer against a question's rubric. Marks are deterministic."""
    answer = (answer or "").strip()
    concepts = [c.lower() for c in (question.get("expectedConcepts") or [])]
    max_marks = float(question.get("maxMarks") or 10)

    normalized = _normalize(answer)
    words = re.findall(r"[a-z0-9']+", normalized)
    word_count = len(words)

    # Guardrail: an empty or extremely short answer cannot demonstrate anything.
    if word_count < 3:
        return {
            "marksAwarded": 0,
            "maxMarks": max_marks,
            "percentage": 0,
            "matchedConcepts": [],
            "missingConcepts": concepts,
            "breakdown": {
                "technicalAccuracy": 0,
                "completeness": 0,
                "practicalExamples": 0,
                "understanding": 0,
            },
            "similarity": 0.0,
            "explanation": (
                "The answer is too short to assess against the rubric. "
                "This is not a judgement about the candidate; it means there is "
                "insufficient technical evidence in this answer."
            ),
            "suggestedFollowUp": (
                f"Could you walk through your reasoning on '{concepts[0]}' in more detail?"
                if concepts
                else "Could you expand your answer with a concrete example?"
            ),
            "answerWordCount": word_count,
        }

    matched = [c for c in concepts if _concept_hit(c, normalized)]
    missing = [c for c in concepts if c not in matched]
    coverage = len(matched) / len(concepts) if concepts else 0.0

    similarity = _similarity(normalized, " ".join(concepts) + " " + question.get("text", ""))
    # Similarity is supporting evidence only, with a modest effect.
    technical = min(1.0, 0.75 * coverage + 0.25 * similarity * 2)

    # Completeness: coverage plus a reasonable answer length (soft cap by difficulty).
    target_words = {"Beginner": 35, "Intermediate": 60, "Advanced": 90}.get(difficulty, 60)
    length_factor = min(1.0, word_count / target_words)
    completeness = min(1.0, 0.65 * coverage + 0.35 * length_factor)

    # Practical examples: explicit example markers and specificity (numbers/names).
    example_hits = sum(1 for m in EXAMPLE_MARKERS if m in normalized)
    specificity = len(re.findall(r"\b\d+\b", normalized))
    has_details = len(re.findall(r"\b[A-Z][a-z]{2,}\b", answer)) >= 1
    practical = min(1.0, 0.35 * example_hits + 0.15 * min(3, specificity) + (0.2 if has_details else 0) + 0.3 * coverage)

    # Understanding: reasoning/trade-off language plus concept coverage.
    reasoning_hits = sum(1 for m in REASONING_MARKERS if m in normalized)
    understanding = min(1.0, 0.45 * min(1.0, reasoning_hits / 3) + 0.55 * coverage)

    breakdown = {
        "technicalAccuracy": round(technical, 3),
        "completeness": round(completeness, 3),
        "practicalExamples": round(practical, 3),
        "understanding": round(understanding, 3),
    }
    weighted = (
        breakdown["technicalAccuracy"] * 0.4
        + breakdown["completeness"] * 0.25
        + breakdown["practicalExamples"] * 0.2
        + breakdown["understanding"] * 0.15
    )
    marks = round(max_marks * weighted * 2) / 2  # nearest 0.5
    percentage = round((marks / max_marks) * 100) if max_marks else 0

    if not missing:
        missing_text = "All expected concepts were addressed."
    else:
        missing_text = f"Not addressed: {', '.join(missing)}."

    explanation = (
        f"Concept coverage {len(matched)}/{len(concepts)} "
        f"(TF-IDF similarity {similarity:.2f}). {missing_text} "
        f"Marks reflect the rubric: technical accuracy 40%, completeness 25%, "
        f"practical examples 20%, understanding 15%."
    )

    follow_up = None
    if missing:
        follow_up = (
            f"Your answer did not cover '{missing[0]}'. Can you explain how that "
            f"applies to your work?"
        )
    elif word_count < target_words * 0.6:
        follow_up = "Could you add a concrete example to make that more specific?"

    return {
        "marksAwarded": marks,
        "maxMarks": max_marks,
        "percentage": percentage,
        "matchedConcepts": matched,
        "missingConcepts": missing,
        "breakdown": breakdown,
        "similarity": round(similarity, 3),
        "explanation": explanation,
        "suggestedFollowUp": follow_up,
        "answerWordCount": word_count,
    }
