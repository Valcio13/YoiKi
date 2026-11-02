import { Hono } from 'hono'
import { Env } from '../index'
import { resolveAuth } from '../lib/auth'

export const participantsRouter = new Hono<{ Bindings: Env }>()

// GET /api/participants/me — Player gets their own info
participantsRouter.get('/me', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'player') return c.json({ error: 'Unauthorized' }, 401)

  const db = c.env.DB
  const participant = await db.prepare(
    'SELECT id, session_id, slot, display_name, points FROM participants WHERE id = ?'
  ).bind(auth.participantId).first()

  if (!participant) return c.json({ error: 'Not found' }, 404)
  return c.json(participant)
})
