import { Hono } from 'hono'
import { Env } from '../index'
import { newId, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'
import { broadcastInvalidation } from '../lib/broadcast'

export const pointsRouter = new Hono<{ Bindings: Env }>()

// POST /api/points — Host adjusts player points
pointsRouter.post('/', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{
    participantId: string
    delta: number
    reason: string
  }>()

  const db = c.env.DB
  const participant = await db.prepare('SELECT id, session_id FROM participants WHERE id = ?')
    .bind(body.participantId).first<any>()
  if (!participant || participant.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const txId = newId()
  await db.batch([
    db.prepare('UPDATE participants SET points = MAX(0, points + ?) WHERE id = ?')
      .bind(body.delta, body.participantId),
    db.prepare(`
      INSERT INTO point_transactions (id, participant_id, session_id, delta, reason, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'host')
    `).bind(txId, body.participantId, auth.sessionId, body.delta, body.reason || 'manual', now()),
  ])

  const updated = await db.prepare('SELECT points FROM participants WHERE id = ?')
    .bind(body.participantId).first<{ points: number }>()

  await broadcastInvalidation(c.env, auth.sessionId, 'points', {
    participantId: body.participantId,
    delta: body.delta,
    newBalance: updated?.points ?? 0,
  })

  return c.json({ ok: true, newBalance: updated?.points ?? 0 })
})

// GET /api/points/:sessionId/history — Get transaction history
pointsRouter.get('/:sessionId/history', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const sessionId = c.req.param('sessionId')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const txs = await db.prepare(`
    SELECT pt.*, p.display_name, p.slot
    FROM point_transactions pt
    JOIN participants p ON pt.participant_id = p.id
    WHERE pt.session_id = ?
    ORDER BY pt.created_at DESC
    LIMIT 100
  `).bind(sessionId).all()

  return c.json(txs.results)
})
