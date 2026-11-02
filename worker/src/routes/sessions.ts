import { Hono } from 'hono'
import { Env } from '../index'
import { newId, newToken, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'

export const sessionsRouter = new Hono<{ Bindings: Env }>()

// POST /api/sessions — Host creates a new game session
sessionsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    mode: '1p' | '2p'
    playerNames: string[]
    startingPoints?: number
  }>()

  if (!['1p', '2p'].includes(body.mode)) {
    return c.json({ error: 'Invalid mode' }, 400)
  }

  const expectedPlayers = body.mode === '2p' ? 2 : 1
  if (!body.playerNames || body.playerNames.length !== expectedPlayers) {
    return c.json({ error: `Need exactly ${expectedPlayers} player name(s)` }, 400)
  }

  const sessionId = newId()
  const hostToken = newToken()
  const spectatorToken = newToken()
  const startPoints = Math.max(0, body.startingPoints ?? 100)

  const db = c.env.DB

  // Create session
  await db.prepare(`
    INSERT INTO sessions (id, host_token, spectator_token, mode, status, current_round, created_at)
    VALUES (?, ?, ?, ?, 'lobby', 0, ?)
  `).bind(sessionId, hostToken, spectatorToken, body.mode, now()).run()

  // Create participants
  const participants: Array<{ id: string; slot: number; name: string; token: string }> = []
  for (let i = 0; i < body.playerNames.length; i++) {
    const pId = newId()
    const pToken = newToken()
    const slot = i + 1
    await db.prepare(`
      INSERT INTO participants (id, session_id, slot, display_name, token, points)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(pId, sessionId, slot, body.playerNames[i].trim(), pToken, startPoints).run()
    participants.push({ id: pId, slot, name: body.playerNames[i].trim(), token: pToken })
  }

  return c.json({
    sessionId,
    hostToken,
    spectatorToken,
    mode: body.mode,
    participants: participants.map(p => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      joinToken: p.token,
    })),
  }, 201)
})

// GET /api/sessions/:id — Get session info (requires auth)
sessionsRouter.get('/:id', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('id')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const session = await db.prepare(
    'SELECT id, mode, status, current_round, created_at FROM sessions WHERE id = ?'
  ).bind(sessionId).first()
  if (!session) return c.json({ error: 'Not found' }, 404)

  const participants = await db.prepare(
    'SELECT id, slot, display_name, points FROM participants WHERE session_id = ?'
  ).bind(sessionId).all()

  // Only host/spectator see all participants; player only sees session status
  if (auth.role === 'player') {
    const self = participants.results.find((p: any) => p.id === auth.participantId)
    return c.json({ session, self })
  }

  return c.json({ session, participants: participants.results })
})

// PATCH /api/sessions/:id/status — Host controls round lifecycle
sessionsRouter.patch('/:id/status', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const sessionId = c.req.param('id')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{ status: string }>()
  const validStatuses = ['lobby', 'playing', 'results', 'ended']
  if (!validStatuses.includes(body.status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  const db = c.env.DB
  await db.prepare('UPDATE sessions SET status = ? WHERE id = ?')
    .bind(body.status, sessionId).run()

  // Keep active round status in sync
  if (['results', 'ended'].includes(body.status)) {
    await db.prepare(`
      UPDATE rounds SET status = ?, ended_at = ?
      WHERE session_id = ? AND status = 'active'
    `).bind(body.status, now(), sessionId).run()
  }

  return c.json({ ok: true, status: body.status })
})
