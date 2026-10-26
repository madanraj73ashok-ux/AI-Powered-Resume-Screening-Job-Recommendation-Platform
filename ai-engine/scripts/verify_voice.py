"""Real offline synthesis/recognition test with synthetic speech, not a mic test."""
import io
import json
import math
import re
import sys
import time
import wave
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.speech import synthesize, transcribe_pcm, speech_status


def error_rate(reference, actual):
    a = re.findall(r'\w+', reference.lower())
    b = re.findall(r'\w+', actual.lower())
    row = list(range(len(b) + 1))
    for i, word in enumerate(a, 1):
        next_row = [i]
        for j, other in enumerate(b, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (word != other)))
        row = next_row
    return row[-1] / max(1, len(a))


def main():
    assert speech_status()['ready'], 'Provision local speech models first.'
    phrases = ['Python generators produce one item at a time and save memory when processing large datasets.',
               'In my project I compared two approaches because reliability mattered. I tested the result and documented the trade-offs.']
    results = []
    for phrase in phrases:
        start = time.perf_counter()
        audio = synthesize(phrase)
        tts_seconds = time.perf_counter() - start
        with wave.open(io.BytesIO(audio), 'rb') as w:
            rate = w.getframerate()
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32)
        divisor = math.gcd(rate, 16000)
        pcm = resample_poly(samples, 16000 // divisor, rate // divisor).astype('<i2').tobytes()
        start = time.perf_counter()
        result = transcribe_pcm(pcm)
        stt_seconds = time.perf_counter() - start
        wer = error_rate(phrase, result['text'])
        results.append({'source': 'synthetic Piper speech; no human microphone test', 'reference': phrase,
                        'recognized': result['text'], 'wordErrorRate': round(wer, 3),
                        'audioSeconds': round(len(pcm) / 32000, 2), 'synthesisSeconds': round(tts_seconds, 2),
                        'transcriptionSeconds': round(stt_seconds, 2), 'reviewRequired': result['reviewRequired']})
        assert result['text'] and wer < 0.4, json.dumps(results[-1])
    print(json.dumps({'passed': True, 'samples': results}, indent=2))


if __name__ == '__main__':
    main()
