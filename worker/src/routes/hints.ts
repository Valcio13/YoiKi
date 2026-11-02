import { Hono } from 'hono'
import { Env } from '../index'
import { newId, now } from '../lib/db'
import { resolveAuth } from '../lib/auth'

export const hintsRouter = new Hono<{ Bindings: Env }>()

// POST /api/hints — Host creates a hint
hintsRouter.post('/', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{
    characterId: string
    textContent?: string
    pointPrice: number
    sortOrder?: number
  }>()

  const db = c.env.DB
  const character = await db.prepare('SELECT session_id FROM characters WHERE id = ?')
    .bind(body.characterId).first<{ session_id: string }>()
  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const id = newId()
  await db.prepare(`
    INSERT INTO hints (id, character_id, sort_order, text_content, point_price)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.characterId, body.sortOrder ?? 0, body.textContent?.trim() ?? null, Math.max(0, body.pointPrice)).run()

  return c.json({ id }, 201)
})

// POST /api/hints/:id/image — Host uploads hint image
hintsRouter.post('/:id/image', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const hintId = c.req.param('id')
  const db = c.env.DB
  const hint = await db.prepare(`
    SELECT h.id, c.session_id FROM hints h JOIN characters c ON h.character_id = c.id WHERE h.id = ?
  `).bind(hintId).first<any>()

  if (!hint || hint.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const formData = await c.req.formData()
  const file = formData.get('image') as File | null
  if (!file) return c.json({ error: 'No image provided' }, 400)

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!validTypes.includes(file.type)) return c.json({ error: 'Invalid file type' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'File too large (max 5MB)' }, 400)

  const key = `hints/${auth.sessionId}/${hintId}/${Date.now()}`
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  await db.prepare('UPDATE hints SET image_key = ? WHERE id = ?').bind(key, hintId).run()
  return c.json({ key })
})

// GET /api/hints/:characterId — Get hints for a character (role-filtered)
hintsRouter.get('/:characterId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const characterId = c.req.param('characterId')
  const db = c.env.DB

  const character = await db.prepare('SELECT session_id, guessed_by_slot, held_by_slot, revealed FROM characters WHERE id = ?')
    .bind(characterId).first<any>()
  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const hints = await db.prepare(
    'SELECT id, character_id, sort_order, text_content, point_price, image_key FROM hints WHERE character_id = ? ORDER BY sort_order ASC'
  ).bind(characterId).all()

  if (auth.role === 'host') {
    return c.json(hints.results.map((h: any) => ({
      ...h,
      has_image: !!h.image_key,
    })))
  }

  // Spectator: unrevealed hints should NOT be exposed
  if (auth.role === 'spectator') {
    return c.json([])
  }

  // Player role:
  // Players can only buy/view hints for the character they are GUESSING
  if (character.guessed_by_slot !== auth.participantSlot && character.revealed !== 1) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const purchases = await db.prepare(
    'SELECT hint_id FROM hint_purchases WHERE participant_id = ?'
  ).bind(auth.participantId).all()
  const purchasedIds = new Set(purchases.results.map((p: any) => p.hint_id))

  const hintsWithStatus = hints.results.map((h: any) => {
    const isPurchased = purchasedIds.has(h.id) || character.revealed === 1
    return {
      id: h.id,
      character_id: h.character_id,
      sort_order: h.sort_order,
      point_price: h.point_price,
      has_image: !!h.image_key,
      purchased: isPurchased,
      text_content: isPurchased ? h.text_content : null,
    }
  })

  return c.json(hintsWithStatus)
})

// GET /api/hints/:id/image — Serve hint image (secured!)
hintsRouter.get('/:id/image', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const hintId = c.req.param('id')
  const db = c.env.DB

  const hint = await db.prepare(`
    SELECT h.id, h.image_key, c.session_id, c.revealed, c.guessed_by_slot
    FROM hints h JOIN characters c ON h.character_id = c.id
    WHERE h.id = ?
  `).bind(hintId).first<any>()

  if (!hint || hint.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)
  if (!hint.image_key) return c.json({ error: 'No image' }, 404)

  if (auth.role === 'host') {
    // Host can view all
  } else if (auth.role === 'player') {
    // Player can view ONLY if purchased or revealed
    if (hint.revealed !== 1) {
      const purchase = await db.prepare(
        'SELECT id FROM hint_purchases WHERE hint_id = ? AND participant_id = ?'
      ).bind(hintId, auth.participantId).first()
      if (!purchase) {
        return c.json({ error: 'Must purchase hint first' }, 403)
      }
    }
  } else {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const obj = await c.env.STORAGE.get(hint.image_key)
  if (!obj) return c.json({ error: 'Image not found' }, 404)

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

// POST /api/hints/:hintId/purchase — Player purchases a hint (atomic)
hintsRouter.post('/:hintId/purchase', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'player') return c.json({ error: 'Forbidden' }, 403)

  const hintId = c.req.param('hintId')
  const db = c.env.DB

  const hint = await db.prepare(`
    SELECT h.id, h.point_price, h.text_content, h.image_key, h.character_id, c.session_id, c.guessed_by_slot
    FROM hints h JOIN characters c ON h.character_id = c.id
    WHERE h.id = ?
  `).bind(hintId).first<any>()

  if (!hint) return c.json({ error: 'Hint not found' }, 404)
  if (hint.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)
  if (hint.guessed_by_slot !== auth.participantSlot) return c.json({ error: 'Forbidden' }, 403)

  // Check if already purchased (idempotent)
  const existing = await db.prepare(
    'SELECT id FROM hint_purchases WHERE hint_id = ? AND participant_id = ?'
  ).bind(hintId, auth.participantId).first()
  if (existing) {
    return c.json({
      ok: true,
      hint: {
        id: hint.id,
        text_content: hint.text_content,
        has_image: !!hint.image_key,
      },
      message: 'Already purchased',
    })
  }

  // Check balance
  const participant = await db.prepare('SELECT points FROM participants WHERE id = ?')
    .bind(auth.participantId).first<{ points: number }>()
  if (!participant || participant.points < hint.point_price) {
    return c.json({ error: 'Insufficient points' }, 402)
  }

  const purchaseId = newId()
  const txId = newId()
  await db.batch([
    db.prepare(`
      INSERT INTO hint_purchases (id, hint_id, participant_id, points_deducted, purchased_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(purchaseId, hintId, auth.participantId, hint.point_price, now()),
    db.prepare('UPDATE participants SET points = points - ? WHERE id = ? AND points >= ?')
      .bind(hint.point_price, auth.participantId, hint.point_price),
    db.prepare(`
      INSERT INTO point_transactions (id, participant_id, session_id, delta, reason, created_at, created_by)
      VALUES (?, ?, ?, ?, 'hint_purchase', ?, 'system')
    `).bind(txId, auth.participantId, auth.sessionId, -hint.point_price, now()),
  ])

  const updatedParticipant = await db.prepare('SELECT points FROM participants WHERE id = ?')
    .bind(auth.participantId).first<{ points: number }>()

  return c.json({
    ok: true,
    hint: {
      id: hint.id,
      text_content: hint.text_content,
      has_image: !!hint.image_key,
    },
    newBalance: updatedParticipant?.points ?? 0,
  })
})

// DELETE /api/hints/:id — Host deletes a hint
hintsRouter.delete('/:id', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const hintId = c.req.param('id')
  const db = c.env.DB

  const hint = await db.prepare(`
    SELECT h.id, c.session_id FROM hints h JOIN characters c ON h.character_id = c.id WHERE h.id = ?
  `).bind(hintId).first<any>()

  if (!hint || hint.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  await db.batch([
    db.prepare('DELETE FROM hint_purchases WHERE hint_id = ?').bind(hintId),
    db.prepare('DELETE FROM hints WHERE id = ?').bind(hintId),
  ])

  return c.json({ ok: true })
})
