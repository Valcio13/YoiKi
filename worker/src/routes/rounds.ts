import { Hono } from 'hono'
import { Env } from '../index'
import { newId, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'
import { broadcastInvalidation } from '../lib/broadcast'

export const roundsRouter = new Hono<{ Bindings: Env }>()

// POST /api/rounds — Host starts a new round
roundsRouter.post('/', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ sessionId: string }>()
  if (auth.sessionId !== body.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const session = await db.prepare('SELECT current_round FROM sessions WHERE id = ?')
    .bind(body.sessionId).first<{ current_round: number }>()
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const roundNumber = (session.current_round || 0) + 1
  const roundId = newId()

  await db.batch([
    db.prepare(`INSERT INTO rounds (id, session_id, round_number, status, started_at) VALUES (?, ?, ?, 'active', ?)`)
      .bind(roundId, body.sessionId, roundNumber, now()),
    db.prepare(`UPDATE sessions SET current_round = ?, status = 'playing' WHERE id = ?`)
      .bind(roundNumber, body.sessionId),
  ])

  await broadcastInvalidation(c.env, body.sessionId, 'round', { roundId, roundNumber })

  return c.json({ roundId, roundNumber }, 201)
})

// GET /api/rounds/:sessionId — Get rounds for a session
roundsRouter.get('/:sessionId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('sessionId')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const rounds = await db.prepare(
    'SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number'
  ).bind(sessionId).all()

  return c.json(rounds.results)
})

// PATCH /api/rounds/:roundId — Update round status
roundsRouter.patch('/:roundId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const roundId = c.req.param('roundId')
  const body = await c.req.json<{ status: string }>()

  const db = c.env.DB
  const round = await db.prepare('SELECT session_id FROM rounds WHERE id = ?')
    .bind(roundId).first<{ session_id: string }>()
  if (!round || round.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  await db.prepare('UPDATE rounds SET status = ?, ended_at = ? WHERE id = ?')
    .bind(body.status, body.status === 'ended' ? now() : null, roundId).run()

  await broadcastInvalidation(c.env, auth.sessionId, 'round', { roundId, status: body.status })

  return c.json({ ok: true })
})
