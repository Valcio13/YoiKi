import { Env } from '../index'

export type InvalidationScope = 'round' | 'character' | 'hint' | 'points' | 'drawing' | 'session' | 'all'

export async function broadcastInvalidation(
  env: Env,
  sessionId: string,
  scope: InvalidationScope,
  extra?: Record<string, any>
): Promise<void> {
  if (!env.GAME_ROOM || !sessionId) return
  try {
    const id = env.GAME_ROOM.idFromName(sessionId)
    const stub = env.GAME_ROOM.get(id)
    const message = {
      type: 'invalidate',
      scope,
      ts: Date.now(),
      ...extra,
    }
    await stub.fetch('http://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, data: message }),
    })
  } catch (err) {
    console.error(`[broadcastInvalidation] Failed to broadcast '${scope}' for session ${sessionId}:`, err)
  }
}
