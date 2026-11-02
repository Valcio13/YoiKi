import { Hono } from 'hono'
import { Env } from '../index'
import { newId } from '../lib/db'
import { resolveAuth } from '../lib/auth'

export const charactersRouter = new Hono<{ Bindings: Env }>()

// POST /api/characters — Host assigns/creates a character for a round
charactersRouter.post('/', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json<{
    sessionId: string
    roundId: string
    heldBySlot: number
    guessedBySlot: number
    name: string
  }>()

  if (auth.sessionId !== body.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const id = newId()
  await db.prepare(`
    INSERT INTO characters (id, session_id, round_id, held_by_slot, guessed_by_slot, name, revealed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).bind(id, body.sessionId, body.roundId, body.heldBySlot, body.guessedBySlot, body.name.trim()).run()

  return c.json({ id }, 201)
})

// GET /api/characters/:sessionId/:roundId — Get characters (role-filtered)
charactersRouter.get('/:sessionId/:roundId', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const { sessionId, roundId } = c.req.param()
  if (auth.sessionId !== sessionId) return c.json({ error: 'Forbidden' }, 403)

  const db = c.env.DB
  const characters = await db.prepare(
    'SELECT * FROM characters WHERE session_id = ? AND round_id = ?'
  ).bind(sessionId, roundId).all()

  if (auth.role === 'host') {
    return c.json(characters.results)
  }

  if (auth.role === 'spectator') {
    // Spectator only sees characters that have been explicitly revealed
    const revealed = characters.results.filter((ch: any) => ch.revealed === 1)
    return c.json(revealed)
  }

  // Player role:
  // 1. Full info for character they HOLD
  // 2. Full info for revealed characters
  // 3. For the character they are GUESSING, only return non-spoiler metadata (id, point shop target), NOT the name or image!
  const slot = auth.participantSlot
  const visible = characters.results.map((ch: any) => {
    if (ch.held_by_slot === slot || ch.revealed === 1) {
      return ch
    }
    if (ch.guessed_by_slot === slot) {
      // Redacted version so player knows their character ID for the hint shop
      return {
        id: ch.id,
        session_id: ch.session_id,
        round_id: ch.round_id,
        held_by_slot: ch.held_by_slot,
        guessed_by_slot: ch.guessed_by_slot,
        name: '??? (Secret)',
        image_key: null,
        revealed: 0,
      }
    }
    return null
  }).filter(Boolean)

  return c.json(visible)
})

// PATCH /api/characters/:id/reveal — Host reveals a character
charactersRouter.patch('/:id/reveal', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const characterId = c.req.param('id')
  const db = c.env.DB
  const character = await db.prepare('SELECT session_id FROM characters WHERE id = ?')
    .bind(characterId).first<{ session_id: string }>()
  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  await db.prepare('UPDATE characters SET revealed = 1 WHERE id = ?').bind(characterId).run()
  return c.json({ ok: true, revealed: true })
})

// POST /api/characters/:id/image — Upload character image
charactersRouter.post('/:id/image', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const characterId = c.req.param('id')
  const db = c.env.DB
  const character = await db.prepare('SELECT session_id FROM characters WHERE id = ?')
    .bind(characterId).first<{ session_id: string }>()
  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  const formData = await c.req.formData()
  const file = formData.get('image') as File | null
  if (!file) return c.json({ error: 'No image provided' }, 400)

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!validTypes.includes(file.type)) return c.json({ error: 'Invalid file type' }, 400)
  if (file.size > 5 * 1024 * 1024) return c.json({ error: 'File too large (max 5MB)' }, 400)

  const key = `characters/${auth.sessionId}/${characterId}/${Date.now()}`
  await c.env.STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  await db.prepare('UPDATE characters SET image_key = ? WHERE id = ?')
    .bind(key, characterId).run()

  return c.json({ key })
})

// GET /api/characters/:id/image — Serve character image (role-checked)
charactersRouter.get('/:id/image', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)

  const characterId = c.req.param('id')
  const db = c.env.DB
  const character = await db.prepare(
    'SELECT session_id, held_by_slot, guessed_by_slot, image_key, revealed FROM characters WHERE id = ?'
  ).bind(characterId).first<any>()

  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  // Spectator: only if revealed
  if (auth.role === 'spectator' && character.revealed !== 1) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Player: only if they hold it or it is revealed
  if (auth.role === 'player' && character.held_by_slot !== auth.participantSlot && character.revealed !== 1) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (!character.image_key) return c.json({ error: 'No image' }, 404)

  const obj = await c.env.STORAGE.get(character.image_key)
  if (!obj) return c.json({ error: 'Image not found' }, 404)

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

// DELETE /api/characters/:id — Host deletes a character
charactersRouter.delete('/:id', async (c) => {
  const auth = await resolveAuth(c)
  if (!auth || auth.role !== 'host') return c.json({ error: 'Forbidden' }, 403)

  const characterId = c.req.param('id')
  const db = c.env.DB
  const character = await db.prepare('SELECT session_id FROM characters WHERE id = ?')
    .bind(characterId).first<{ session_id: string }>()
  if (!character || character.session_id !== auth.sessionId) return c.json({ error: 'Forbidden' }, 403)

  // Delete hints, purchases, and character
  await db.batch([
    db.prepare('DELETE FROM hint_purchases WHERE hint_id IN (SELECT id FROM hints WHERE character_id = ?)').bind(characterId),
    db.prepare('DELETE FROM hints WHERE character_id = ?').bind(characterId),
    db.prepare('DELETE FROM characters WHERE id = ?').bind(characterId),
  ])

  return c.json({ ok: true })
})
