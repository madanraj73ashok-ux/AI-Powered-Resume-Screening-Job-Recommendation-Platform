"""Offline speech only. Never downloads a model while handling a request.

Whisper runs on short cumulative audio windows: near-real-time chunked ASR,
not a streaming decoder. Raw PCM and synthesized WAV bytes live in memory only.
"""
from __future__ import annotations

import io
import os
import threading
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/speech")
ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = Path(os.environ.get("VOICE_MODEL_DIR", str(ROOT / "models")))
WHISPER_PATH = Path(os.environ.get("WHISPER_MODEL_PATH", str(MODEL_ROOT / "whisper-tiny.en")))
VOICES = {"lessac": (MODEL_ROOT / "en_US-lessac-medium.onnx", "Lessac · US English")}
if os.environ.get("PIPER_VOICE_PATH"):
    VOICES["custom"] = (Path(os.environ["PIPER_VOICE_PATH"]), os.environ.get("PIPER_VOICE_NAME", "Additional local voice"))
SAMPLE_RATE = 16000
MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * 90
_lock = threading.Lock()
_whisper = None
_voices: dict = {}


@lru_cache(maxsize=1)
def runtime_readiness() -> tuple[bool, bool]:
    try:
        from faster_whisper import WhisperModel  # noqa: F401
        stt = True
    except (ImportError, OSError):
        stt = False
    try:
        from piper import PiperVoice  # noqa: F401
        tts = True
    except (ImportError, OSError):
        tts = False
    return stt, tts


def speech_status() -> dict:
    runtime_stt, runtime_tts = runtime_readiness()
    stt = runtime_stt and (WHISPER_PATH / "model.bin").is_file()
    voices = [{"id": key, "name": label} for key, (path, label) in VOICES.items()
              if path.is_file() and Path(str(path) + ".json").is_file()]
    tts = runtime_tts and bool(voices)
    return {"sttReady": stt, "ttsReady": tts, "ready": stt and tts,
            "voices": voices, "mode": "local-chunked-half-duplex", "sampleRate": SAMPLE_RATE,
            "maxUtteranceSeconds": 90, "externalInference": False,
            "setup": "Install requirements-voice.txt and run python scripts/setup_voice.py --download."}


def transcribe_pcm(data: bytes) -> dict:
    global _whisper
    if not data or len(data) % 2 or len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(422, "Expected mono PCM16 at 16000 Hz, maximum 90 seconds.")
    if not speech_status()["sttReady"]:
        raise HTTPException(503, "Local Whisper model is unavailable. Run the explicit voice setup command.")
    audio = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
    # Avoid hallucinated text on digital silence. Silero removes nonspeech next.
    if len(audio) < 3200 or float(np.sqrt(np.mean(audio ** 2))) < 0.002:
        return {"text": "", "reviewRequired": True, "reason": "No clear speech detected.", "segments": []}
    if not _lock.acquire(blocking=False):
        raise HTTPException(429, "Local speech engine is busy; try again shortly.")
    try:
        if _whisper is None:
            from faster_whisper import WhisperModel
            device = os.environ.get("WHISPER_DEVICE", "cpu")
            _whisper = WhisperModel(str(WHISPER_PATH), device=device,
                                    compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "int8_float16"),
                                    cpu_threads=4, num_workers=1, local_files_only=True)
        segments, _ = _whisper.transcribe(audio, language="en", beam_size=3,
                                         vad_filter=True, condition_on_previous_text=False,
                                         vad_parameters={"min_silence_duration_ms": 500})
        items = [{"text": s.text.strip(), "start": s.start, "end": s.end,
                  "avgLogprob": s.avg_logprob, "noSpeechProbability": s.no_speech_prob}
                 for s in segments]
        text = " ".join(s["text"] for s in items).strip()[:8000]
        review = not text or any(s["avgLogprob"] < -0.9 or s["noSpeechProbability"] > 0.5 for s in items)
        return {"text": text, "reviewRequired": review, "segments": items,
                "reason": "Recognition uncertainty: review before scoring." if review else None,
                "durationSeconds": round(len(audio) / SAMPLE_RATE, 2)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Local speech recognition failed. Retry or use text mode.") from exc
    finally:
        _lock.release()


def synthesize(text: str, voice_id: str = "lessac", rate: float = 1.0) -> bytes:
    if voice_id not in VOICES:
        raise HTTPException(422, "Unknown local voice.")
    if not speech_status()["ttsReady"]:
        raise HTTPException(503, "Piper voice is unavailable. Run the explicit voice setup command.")
    if not _lock.acquire(blocking=False):
        raise HTTPException(429, "Local speech engine is busy; try again shortly.")
    try:
        from piper import PiperVoice, SynthesisConfig
        if voice_id not in _voices:
            _voices[voice_id] = PiperVoice.load(str(VOICES[voice_id][0]), use_cuda=False)
        result = io.BytesIO()
        with wave.open(result, "wb") as output:
            _voices[voice_id].synthesize_wav(text, output, syn_config=SynthesisConfig(length_scale=1.0 / rate))
        return result.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Local speech synthesis failed. Retry or use text mode.") from exc
    finally:
        _lock.release()


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    voice: str = "lessac"
    rate: float = Field(default=1, ge=0.7, le=1.3)


@router.get("/status")
def status():
    return speech_status()


@router.post("/transcribe")
async def transcribe(request: Request):
    # Stream-read with a hard bound; do not trust Content-Length.
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Audio exceeds the 90-second limit.")
        data.extend(chunk)
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(transcribe_pcm, bytes(data))


@router.post("/synthesize")
def speech(req: SpeechRequest):
    return Response(synthesize(req.text, req.voice, req.rate), media_type="audio/wav",
                    headers={"Cache-Control": "no-store"})
