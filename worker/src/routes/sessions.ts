import { Hono } from 'hono'
import { Env } from '../index'
import { newId, newToken, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'
import { broadcastInvalidation } from '../lib/broadcast'

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
    auth.role === 'host'
      ? 'SELECT id, mode, status, current_round, created_at, spectator_token FROM sessions WHERE id = ?'
      : 'SELECT id, mode, status, current_round, created_at FROM sessions WHERE id = ?'
  ).bind(sessionId).first()
  if (!session) return c.json({ error: 'Not found' }, 404)

  const participants = await db.prepare(
    'SELECT id, slot, display_name, points FROM participants WHERE session_id = ?'
  ).bind(sessionId).all()

  // All roles see participant list (names & points)
  if (auth.role === 'player') {
    const self = participants.results.find((p: any) => p.id === auth.participantId)
    return c.json({ session, self, participants: participants.results })
  }

  return c.json({ session, participants: participants.results })
})

// GET /api/sessions/:id/stats — Full game recap and statistics
sessionsRouter.get('/:id/stats', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('id')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const session = await db.prepare(
    'SELECT id, mode, status, current_round, created_at FROM sessions WHERE id = ?'
  ).bind(sessionId).first<any>()
  if (!session) return c.json({ error: 'Not found' }, 404)

  // Participants ranked by score
  const participants = await db.prepare(
    'SELECT id, slot, display_name, points FROM participants WHERE session_id = ? ORDER BY points DESC'
  ).bind(sessionId).all()

  // Hint purchases stats per participant
  const hintPurchases = await db.prepare(`
    SELECT hp.participant_id, COUNT(*) as count, SUM(hp.points_deducted) as total_spent
    FROM hint_purchases hp
    JOIN participants p ON hp.participant_id = p.id
    WHERE p.session_id = ?
    GROUP BY hp.participant_id
  `).bind(sessionId).all()
  const hintMap: Record<string, { count: number; total_spent: number }> = {}
  for (const h of hintPurchases.results as any[]) {
    hintMap[h.participant_id] = { count: h.count, total_spent: h.total_spent || 0 }
  }

  // Drawings count per participant
  const drawingsCount = await db.prepare(`
    SELECT d.participant_id, COUNT(*) as count
    FROM drawings d
    JOIN rounds r ON d.round_id = r.id
    WHERE r.session_id = ? AND d.submitted = 1
    GROUP BY d.participant_id
  `).bind(sessionId).all()
  const drawMap: Record<string, number> = {}
  for (const d of drawingsCount.results as any[]) {
    drawMap[d.participant_id] = d.count
  }

  // Max score to identify winner
  const pList = participants.results as any[]
  const maxScore = pList.length > 0 ? Math.max(...pList.map((p: any) => p.points)) : 0

  const enhancedParticipants = pList.map((p: any) => ({
    ...p,
    hints_purchased: hintMap[p.id]?.count || 0,
    points_spent_on_hints: hintMap[p.id]?.total_spent || 0,
    drawings_submitted: drawMap[p.id] || 0,
    is_winner: p.points === maxScore && maxScore > 0,
  }))

  // All rounds with characters and submitted drawings
  const rounds = await db.prepare(
    'SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number ASC'
  ).bind(sessionId).all()

  const roundsWithDetails = []
  for (const r of rounds.results as any[]) {
    const chars = await db.prepare(
      'SELECT * FROM characters WHERE round_id = ?'
    ).bind(r.id).all()

    const drws = await db.prepare(`
      SELECT d.*, p.display_name, p.slot
      FROM drawings d
      JOIN participants p ON d.participant_id = p.id
      WHERE d.round_id = ? AND d.submitted = 1
    `).bind(r.id).all()

    roundsWithDetails.push({
      ...r,
      characters: chars.results,
      drawings: drws.results,
    })
  }

  // Transaction history
  const txs = await db.prepare(`
    SELECT pt.*, p.display_name, p.slot
    FROM point_transactions pt
    JOIN participants p ON pt.participant_id = p.id
    WHERE pt.session_id = ?
    ORDER BY pt.created_at DESC
  `).bind(sessionId).all()

  return c.json({
    session,
    participants: enhancedParticipants,
    rounds: roundsWithDetails,
    transactions: txs.results,
  })
})

// POST /api/sessions/:id/restart — Host restarts the session for a new game
sessionsRouter.post('/:id/restart', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const sessionId = c.req.param('id')
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  await db.batch([
    db.prepare('UPDATE sessions SET status = "lobby", current_round = 0 WHERE id = ?').bind(sessionId),
    db.prepare('UPDATE participants SET points = 100 WHERE session_id = ?').bind(sessionId),
    db.prepare(`
      INSERT INTO point_transactions (id, participant_id, session_id, delta, reason, created_at, created_by)
      SELECT hex(randomblob(8)), id, session_id, 100 - points, 'session_restart', unixepoch(), 'host'
      FROM participants WHERE session_id = ?
    `).bind(sessionId),
  ])

  await broadcastInvalidation(c.env, sessionId, 'session', { status: 'lobby' })

  return c.json({ ok: true })
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

  await broadcastInvalidation(c.env, sessionId, 'session', { status: body.status })

  return c.json({ ok: true, status: body.status })
})
