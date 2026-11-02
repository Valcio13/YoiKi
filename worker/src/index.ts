import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sessionsRouter } from './routes/sessions'
import { participantsRouter } from './routes/participants'
import { roundsRouter } from './routes/rounds'
import { charactersRouter } from './routes/characters'
import { hintsRouter } from './routes/hints'
import { pointsRouter } from './routes/points'
import { drawingsRouter } from './routes/drawings'
import { GameRoom } from './do/GameRoom'

export { GameRoom }

export interface Env {
  DB: D1Database
  STORAGE: R2Bucket
  GAME_ROOM: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// WebSocket upgrade for live spectator
app.get('/api/ws/:sessionId', async (c) => {
  const env = c.env
  const sessionId = c.req.param('sessionId')
  const upgradeHeader = c.req.header('Upgrade')
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426)
  }
  const id = env.GAME_ROOM.idFromName(sessionId)
  const stub = env.GAME_ROOM.get(id)
  return stub.fetch(c.req.raw)
})

app.route('/api/sessions', sessionsRouter)
app.route('/api/participants', participantsRouter)
app.route('/api/rounds', roundsRouter)
app.route('/api/characters', charactersRouter)
app.route('/api/hints', hintsRouter)
app.route('/api/points', pointsRouter)
app.route('/api/drawings', drawingsRouter)

// Serve frontend static files (in production, use Cloudflare Pages instead)
app.get('*', (c) => {
  return c.text('YoiKi Worker API', 200)
})

export default app
