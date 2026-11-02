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

let dbInitialized = false

app.use('*', async (c, next) => {
  if (!dbInitialized && c.env.DB) {
    try {
      await c.env.DB.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          host_token TEXT NOT NULL UNIQUE,
          spectator_token TEXT NOT NULL UNIQUE,
          mode TEXT NOT NULL CHECK(mode IN ('1p','2p')),
          status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','playing','results','ended')),
          current_round INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS participants (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          slot INTEGER NOT NULL CHECK(slot IN (1,2)),
          display_name TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          points INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_id, slot)
        );
        CREATE TABLE IF NOT EXISTS rounds (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          round_number INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','results','ended')),
          started_at INTEGER,
          ended_at INTEGER,
          UNIQUE(session_id, round_number)
        );
        CREATE TABLE IF NOT EXISTS characters (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          round_id TEXT REFERENCES rounds(id),
          held_by_slot INTEGER NOT NULL,
          guessed_by_slot INTEGER NOT NULL,
          name TEXT NOT NULL,
          image_key TEXT,
          revealed INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS hints (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(id),
          sort_order INTEGER NOT NULL DEFAULT 0,
          text_content TEXT,
          image_key TEXT,
          point_price INTEGER NOT NULL DEFAULT 10
        );
        CREATE TABLE IF NOT EXISTS hint_purchases (
          id TEXT PRIMARY KEY,
          hint_id TEXT NOT NULL REFERENCES hints(id),
          participant_id TEXT NOT NULL REFERENCES participants(id),
          points_deducted INTEGER NOT NULL,
          purchased_at INTEGER NOT NULL,
          UNIQUE(hint_id, participant_id)
        );
        CREATE TABLE IF NOT EXISTS point_transactions (
          id TEXT PRIMARY KEY,
          participant_id TEXT NOT NULL REFERENCES participants(id),
          session_id TEXT NOT NULL REFERENCES sessions(id),
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS drawings (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id),
          participant_id TEXT NOT NULL REFERENCES participants(id),
          r2_key TEXT,
          submitted INTEGER DEFAULT 0,
          submitted_at INTEGER,
          UNIQUE(round_id, participant_id)
        );
      `)
      dbInitialized = true
    } catch {
      // Ignore if already created or read-only
    }
  }
  await next()
})

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
  return c.text('Yoiki Worker API', 200)
})

export default app
