import mongoose from 'mongoose';

export const EVENT_TYPES = ['connected', 'disconnected', 'mic_muted', 'mic_unmuted',
  'camera_on', 'camera_off', 'camera_unavailable', 'face_visible', 'no_face', 'multiple_faces',
  'detector_unavailable', 'transcription_failed', 'text_fallback', 'speech_interrupted'] as const;

const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewSession', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: EVENT_TYPES, required: true },
  at: { type: Date, default: Date.now },
  // Only face counts and event kinds. No frames, recordings or biometric vectors.
  faceCount: { type: Number, min: 0, max: 20 },
}, { versionKey: false });
export const InterviewEvent = mongoose.model('InterviewEvent', schema);
