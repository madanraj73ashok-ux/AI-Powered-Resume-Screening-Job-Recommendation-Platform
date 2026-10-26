import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import * as service from '../services/liveInterview.service';
import { z } from 'zod';

const router = Router();
router.get('/configuration', async (_req, res, next) => {
  try { res.json(await service.voiceConfiguration()); } catch (error) { next(error); }
});
router.get('/:id/live', async (req, res, next) => {
  try { res.json(await service.liveState(req.params.id, req.user!.id)); } catch (error) { next(error); }
});
router.put('/:id/live/transcript', validateBody(service.draftSchema), async (req, res, next) => {
  try { await service.saveDraft(req.params.id, req.user!.id, req.body); res.json({ saved: true }); } catch (error) { next(error); }
});
router.post('/:id/live/events', validateBody(service.eventSchema), async (req, res, next) => {
  try { await service.logEvent(req.params.id, req.user!.id, req.body); res.status(201).json({ saved: true }); } catch (error) { next(error); }
});
router.post('/:id/live/speech', validateBody(z.object({ kind: z.enum(['question', 'greeting']).default('question') })), async (req, res, next) => {
  try { const { audio, text } = await service.questionAudio(req.params.id, req.user!.id, req.body.kind);
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Interviewer-Text': encodeURIComponent(text) }).send(audio);
  } catch (error) { next(error); }
});
export default router;
