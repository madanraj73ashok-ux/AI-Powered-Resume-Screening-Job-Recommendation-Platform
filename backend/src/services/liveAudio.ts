import { Server } from 'http';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import env from '../config/env';
import { ApiError } from '../middleware/errors';
import { requireLive, saveDraft, logEvent, transcribeAudio } from './liveInterview.service';

const controls = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), questionId: z.string().min(1).max(100) }),
  z.object({ type: z.literal('finish') }), z.object({ type: z.literal('cancel') }),
]);
const MAX_AUDIO = 16000 * 2 * 90;

export function attachLiveAudio(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const clients = new Map<string, WebSocket>();
  function reject(socket: Duplex, status: number) {
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const match = /^\/api\/interviews\/([a-f\d]{24})\/live\/audio$/.exec(req.url ?? '');
    if (!match) { reject(socket, 404); return; }
    void (async () => {
      if (req.headers.origin !== env.frontendOrigin) throw new ApiError(403, 'Origin rejected');
      const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('vh_token='))?.slice(9);
      if (!raw) throw new ApiError(401, 'Authentication required');
      let user: jwt.JwtPayload;
      try { user = jwt.verify(decodeURIComponent(raw), env.jwtSecret) as jwt.JwtPayload; }
      catch { throw new ApiError(401, 'Invalid session'); }
      if (!user.sub || user.role !== 'candidate') throw new ApiError(403, 'Candidate account required');
      const uid = String(user.sub), id = match[1];
      await requireLive(id, uid);
      if (clients.has(uid) || clients.size >= 4) throw new ApiError(429, 'An audio session is already open');
      wss.handleUpgrade(req, socket, head, ws => {
        clients.set(uid, ws);
        let chunks: Buffer[] = [], size = 0, questionId = '', active = false;
        let busy = false, lastPartial = 0, epoch = 0, finalPending = false;
        let speechSeen = false, silentSamples = 0, started = Date.now(), frames = 0;
        let alive = true;
        let controlsSeen = 0, controlWindow = Date.now();
        const send = (data: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
        const reset = () => { epoch++; chunks = []; size = 0; active = false; finalPending = false; speechSeen = false; silentSamples = 0; };
        async function recognize(final: boolean) {
          if (!active || busy) { if (final && active) finalPending = true; return; }
          const tag = epoch, qid = questionId;
          busy = true;
          if (final) { active = false; send({ type: 'state', state: 'TRANSCRIBING' }); }
          const audio = Buffer.concat(chunks);
          try {
            if (Date.now() - controlWindow > 60000) { controlWindow = Date.now(); controlsSeen = 0; }
            if (++controlsSeen > 120) { ws.close(1008, 'Control rate exceeded'); return; }
            const result = await transcribeAudio(audio);
            if (tag !== epoch || ws.readyState !== WebSocket.OPEN) return;
            if (final) {
              await saveDraft(id, uid, { questionId: qid, text: result.text, reviewRequired: result.reviewRequired });
              chunks = []; size = 0;
            }
            send({ type: final ? 'final' : 'partial', questionId: qid, ...result });
          } catch {
            if (tag === epoch) {
              send({ type: 'error', message: 'Speech recognition could not finish. No answer was scored. Retry or switch to text.' });
              if (final) { chunks = []; size = 0; }
              void logEvent(id, uid, { type: 'transcription_failed' }).catch(() => undefined);
            }
          } finally {
            busy = false;
            if (finalPending && tag === epoch) { finalPending = false; void recognize(true); }
          }
        }
        ws.on('pong', () => { alive = true; });
        const heartbeat = setInterval(() => {
          if (!alive) { ws.terminate(); return; }
          alive = false; ws.ping();
        }, 15000);
        const expiry = setTimeout(() => ws.close(1008, 'Audio session expired; rejoin after signing in'),
          Math.max(1, Math.min(2 * 60 * 60 * 1000, (Number(user.exp ?? 0) * 1000) - Date.now())));
        ws.on('message', (data, binary) => {
          if (binary) {
            if (!active) return;
            const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            frames++;
            if (bytes.length % 2 || bytes.length > 16384 || size + bytes.length > MAX_AUDIO || frames > 6000) {
              reset(); ws.close(1009, 'Audio limit exceeded'); return;
            }
            if (size > (Date.now() - started + 2000) * 64) { reset(); ws.close(1008, 'Audio rate exceeded'); return; }
            chunks.push(bytes); size += bytes.length;
            let energy = 0;
            for (let i = 0; i < bytes.length; i += 2) energy += (bytes.readInt16LE(i) / 32768) ** 2;
            const rms = Math.sqrt(energy / Math.max(1, bytes.length / 2));
            if (rms > 0.012) {
              if (!speechSeen) send({ type: 'speech_start' });
              speechSeen = true; silentSamples = 0;
            } else if (speechSeen) silentSamples += bytes.length / 2;
            if ((speechSeen && silentSamples >= 24000) || size >= MAX_AUDIO - 16384) { void recognize(true); return; }
            if (speechSeen && size > 16000 * 2 * 3 && Date.now() - lastPartial > 5000 && !busy) {
              lastPartial = Date.now(); void recognize(false);
            }
            return;
          }
          try {
            const command = controls.parse(JSON.parse(data.toString()));
            if (command.type === 'cancel') { reset(); send({ type: 'cancelled' }); return; }
            if (command.type === 'finish') { void recognize(true); return; }
            if (busy) { send({ type: 'error', message: 'Transcription is finishing. Try again shortly.' }); return; }
            reset();
            const tag = epoch;
            void requireLive(id, uid).then(s => {
              if (tag !== epoch) return;
              if (s.questions[s.currentIndex]?.id !== command.questionId) {
                send({ type: 'error', message: 'Question changed. Reconnect to the saved session.' }); return;
              }
              questionId = command.questionId; active = true; started = Date.now(); frames = 0; lastPartial = Date.now();
              send({ type: 'listening', questionId });
            }).catch(() => ws.close(1008, 'Session is no longer available'));
          } catch { send({ type: 'error', message: 'Invalid audio control message.' }); }
        });
        ws.on('error', () => undefined);
        ws.on('close', () => {
          reset(); clearInterval(heartbeat); clearTimeout(expiry); clients.delete(uid);
          void logEvent(id, uid, { type: 'disconnected' }).catch(() => undefined);
        });
        send({ type: 'ready', sampleRate: 16000, mode: 'near-real-time-chunked' });
        void logEvent(id, uid, { type: 'connected' }).catch(() => undefined);
      });
    })().catch(error => reject(socket, error instanceof ApiError ? error.status : 401));
  });
  return () => { for (const ws of clients.values()) ws.close(1001, 'Server shutting down'); wss.close(); };
}
