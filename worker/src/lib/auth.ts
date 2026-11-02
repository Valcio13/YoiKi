import { Context } from 'hono'
import { Env } from '../index'

export type Role = 'host' | 'player' | 'spectator'

export interface AuthContext {
  role: Role
  sessionId: string
  participantId?: string
  participantSlot?: number
}

export async function resolveAuth(c: Context<any>): Promise<AuthContext | null> {
  const authHeader = c.req.header('Authorization') || ''
  let token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    token = c.req.query('token')?.trim() || ''
  }
  if (!token) return null

  const db = (c.env as Env).DB

  // Check host token
  const session = await db.prepare(
    'SELECT id FROM sessions WHERE host_token = ?'
  ).bind(token).first<{ id: string }>()
  if (session) {
    return { role: 'host', sessionId: session.id }
  }

  // Check spectator token
  const spectatorSession = await db.prepare(
    'SELECT id FROM sessions WHERE spectator_token = ?'
  ).bind(token).first<{ id: string }>()
  if (spectatorSession) {
    return { role: 'spectator', sessionId: spectatorSession.id }
  }

  // Check player token
  const participant = await db.prepare(
    'SELECT id, session_id, slot FROM participants WHERE token = ?'
  ).bind(token).first<{ id: string; session_id: string; slot: number }>()
  if (participant) {
    return {
      role: 'player',
      sessionId: participant.session_id,
      participantId: participant.id,
      participantSlot: participant.slot,
    }
  }

  return null
}

export function requireAuth(role?: Role) {
  return async (c: Context<any>, next: () => Promise<void>) => {
    const auth = await resolveAuth(c)
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    if (role && auth.role !== role) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    c.set('auth', auth)
    await next()
  }
}
