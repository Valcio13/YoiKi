import { Hono } from 'hono'
import { Env } from '../index'
import { newId, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'

export const drawingsRouter = new Hono<{ Bindings: Env }>()

// POST /api/drawings/submit — Player submits final drawing
drawingsRouter.post('/submit', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'player') return c.json({ error: 'Forbidden' }, 403)

  const formData = await c.req.formData()
  const file = formData.get('drawing') as File | null
  const roundId = formData.get('roundId') as string | null
  if (!file || !roundId) return c.json({ error: 'Missing drawing or roundId' }, 400)

  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File too large' }, 400)
  const validTypes = ['image/png', 'image/jpeg', 'image/webp']
  if (!validTypes.includes(file.type)) return c.json({ error: 'Invalid file type (must be image/png, image/jpeg, or image/webp)' }, 400)

  const db = c.env.DB
  const round = await db.prepare('SELECT id, session_id, status FROM rounds WHERE id = ?')
    .bind(roundId).first<any>()
  if (!round || round.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const key = `drawings/${auth.sessionId}/${roundId}/${auth.participantId}.png`
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: 'image/png' },
  })

  const drawingId = newId()
  await db.prepare(`
    INSERT INTO drawings (id, round_id, participant_id, r2_key, submitted, submitted_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(round_id, participant_id) DO UPDATE SET
      r2_key = excluded.r2_key, submitted = 1, submitted_at = excluded.submitted_at
  `).bind(drawingId, roundId, auth.participantId, key, now()).run()

  return c.json({ ok: true, key })
})

// GET /api/drawings/:roundId — Get drawing metadata for a round
drawingsRouter.get('/:roundId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const roundId = c.req.param('roundId')
  const db = c.env.DB

  const round = await db.prepare('SELECT session_id, status FROM rounds WHERE id = ?')
    .bind(roundId).first<any>()
  if (!round || round.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const drawings = await db.prepare(`
    SELECT d.id, d.round_id, d.participant_id, d.submitted, d.submitted_at, p.display_name, p.slot
    FROM drawings d
    JOIN participants p ON d.participant_id = p.id
    WHERE d.round_id = ?
  `).bind(roundId).all()

  // During playing, players only see their own submitted status; host sees all
  if (auth.role === 'player' && round.status === 'active') {
    const own = drawings.results.filter((d: any) => d.participant_id === auth.participantId)
    return c.json(own)
  }

  return c.json(drawings.results)
})

// GET /api/drawings/image/:drawingId — Serve drawing image
drawingsRouter.get('/image/:drawingId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const drawingId = c.req.param('drawingId')
  const db = c.env.DB

  const drawing = await db.prepare(`
    SELECT d.*, r.session_id, r.status as round_status, s.status as session_status
    FROM drawings d
    JOIN rounds r ON d.round_id = r.id
    JOIN sessions s ON r.session_id = s.id
    WHERE d.id = ?
  `).bind(drawingId).first<any>()
  if (!drawing || drawing.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const isFinalOrEnded = drawing.round_status === 'results' || drawing.round_status === 'ended' || drawing.session_status === 'ended'

  // Player can only see opponent drawing during results/ended
  if (auth.role === 'player' && drawing.participant_id !== auth.participantId) {
    if (!isFinalOrEnded) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  // Spectator can only see drawings during results/ended
  if (auth.role === 'spectator') {
    if (!isFinalOrEnded) {
      return c.json({ error: 'Forbidden' }, 403)
    }
  }

  if (!drawing.r2_key) return c.json({ error: 'No drawing' }, 404)
  const obj = await c.env.STORAGE.get(drawing.r2_key)
  if (!obj) return c.json({ error: 'Not found' }, 404)

  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
  })
})
