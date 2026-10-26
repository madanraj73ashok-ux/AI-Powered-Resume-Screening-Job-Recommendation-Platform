import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app import speech
from app.questions import generate_questions

client = TestClient(app)


def test_unprovisioned_models_fail_without_downloading(monkeypatch, tmp_path):
    monkeypatch.setattr(speech, 'WHISPER_PATH', tmp_path / 'absent')
    monkeypatch.setattr(speech, 'VOICES', {'lessac': (tmp_path / 'absent.onnx', 'Local voice')})
    status = client.get('/speech/status').json()
    assert not status['ready']
    assert not status['externalInference']
    response = client.post('/speech/transcribe', content=b'\x20\x10' * 5000)
    assert response.status_code == 503
    assert not list(tmp_path.iterdir())


def test_silence_does_not_create_a_transcript_or_score(monkeypatch):
    monkeypatch.setattr(speech, 'speech_status', lambda: {'sttReady': True})
    result = speech.transcribe_pcm(b'\0\0' * 16000)
    assert result['text'] == ''
    assert result['reviewRequired']
    assert 'score' not in result


@pytest.mark.parametrize('audio', [b'', b'odd', b'\0' * (speech.MAX_AUDIO_BYTES + 2)], ids=['empty', 'odd-bytes', 'oversized'])
def test_audio_shape_and_size_limits(audio):
    assert client.post('/speech/transcribe', content=audio).status_code in (413, 422)


def test_tts_input_limits_and_missing_voice(monkeypatch):
    assert client.post('/speech/synthesize', json={'text': 'hello', 'rate': 5}).status_code == 422
    assert client.post('/speech/synthesize', json={'text': 'x' * 2501}).status_code == 422
    assert client.post('/speech/synthesize', json={'text': 'hi', 'voice': 'cloud'}).status_code == 422
    monkeypatch.setattr(speech, 'speech_status', lambda: {'ttsReady': False})
    assert client.post('/speech/synthesize', json={'text': 'hello'}).status_code == 503


def test_live_types_and_introduction_reuse_resume_context():
    profile = {'name': 'Test Candidate', 'summary': 'Python developer',
               'skills': [{'skill': 'Python'}], 'projects': [{'text': 'Built a local CSV analysis tool'}]}
    for interview_type in ('HR', 'Technical', 'Project-based', 'Behavioral', 'Mixed'):
        result = generate_questions(profile, difficulty='Intermediate', count=6, interview_type=interview_type)
        assert result['questions'][0]['type'] == 'introduction'
        assert result['questions'][0]['sourceClaim'] == 'Python developer'
        assert len({q['id'] for q in result['questions']}) == result['count']
        if interview_type == 'Project-based':
            assert any('CSV analysis tool' in q['text'] for q in result['questions'])
        if interview_type == 'HR':
            assert all(q['type'] in ('introduction', 'hr', 'behavioral') for q in result['questions'])
    assert client.post('/generate-questions', json={'profile': profile, 'interviewType': 'unsupported'}).status_code == 422
