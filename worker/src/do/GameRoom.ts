import { DurableObject } from 'cloudflare:workers'
import { Env } from '../index'

interface WSMeta {
  role: 'host' | 'player' | 'spectator'
  participantId?: string
  participantSlot?: number
  sessionId: string
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const token = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '') || ''

    const auth = await this.verifyToken(token)
    if (!auth) {
      return new Response('Unauthorized', { status: 401 })
    }

    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server, [JSON.stringify(auth)])

    // Notify host/spectators that a player has connected
    if (auth.role === 'player') {
      this.broadcastToHostAndSpectators(auth.sessionId, {
        type: 'player_status',
        participantId: auth.participantId,
        slot: auth.participantSlot,
        online: true,
      })
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  private async verifyToken(token: string): Promise<WSMeta | null> {
    if (!token) return null
    const db = this.env.DB

    const session = await db.prepare('SELECT id FROM sessions WHERE host_token = ?').bind(token).first<any>()
    if (session) return { role: 'host', sessionId: session.id }

    const spectator = await db.prepare('SELECT id FROM sessions WHERE spectator_token = ?').bind(token).first<any>()
    if (spectator) return { role: 'spectator', sessionId: spectator.id }

    const participant = await db.prepare('SELECT id, session_id, slot FROM participants WHERE token = ?').bind(token).first<any>()
    if (participant) return { role: 'player', participantId: participant.id, participantSlot: participant.slot, sessionId: participant.session_id }

    return null
  }

  private broadcastToHostAndSpectators(sessionId: string, data: any) {
    const sockets = this.ctx.getWebSockets()
    const payload = JSON.stringify(data)
    for (const sock of sockets) {
      try {
        const tags = this.ctx.getTags(sock)
        const meta: WSMeta = JSON.parse(tags[0] || '{}')
        if (meta.sessionId === sessionId && (meta.role === 'host' || meta.role === 'spectator')) {
          sock.send(payload)
        }
      } catch {
        // Socket closed
      }
    }
  }

  private broadcastToAll(sessionId: string, data: any) {
    const sockets = this.ctx.getWebSockets()
    const payload = JSON.stringify(data)
    for (const sock of sockets) {
      try {
        const tags = this.ctx.getTags(sock)
        const meta: WSMeta = JSON.parse(tags[0] || '{}')
        if (meta.sessionId === sessionId) {
          sock.send(payload)
        }
      } catch {
        // Socket closed
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const tags = this.ctx.getTags(ws)
    const meta: WSMeta = JSON.parse(tags[0] || '{}')

    let data: any
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    } catch {
      return
    }

    // Canvas preview from player → forward to host & spectator
    if (data.type === 'preview' && meta.role === 'player') {
      this.broadcastToHostAndSpectators(meta.sessionId, {
        type: 'preview',
        participantId: meta.participantId,
        slot: meta.participantSlot,
        data: data.data,
        ts: Date.now(),
      })
      return
    }

    // Player notifies drawing submitted
    if (data.type === 'drawing_submitted' && meta.role === 'player') {
      this.broadcastToHostAndSpectators(meta.sessionId, {
        type: 'drawing_submitted',
        participantId: meta.participantId,
        slot: meta.participantSlot,
      })
      return
    }

    // Broadcast game state update from host to all
    if (data.type === 'state_update' && meta.role === 'host') {
      this.broadcastToAll(meta.sessionId, data)
      return
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      const tags = this.ctx.getTags(ws)
      const meta: WSMeta = JSON.parse(tags[0] || '{}')
      if (meta.role === 'player') {
        this.broadcastToHostAndSpectators(meta.sessionId, {
          type: 'player_status',
          participantId: meta.participantId,
          slot: meta.participantSlot,
          online: false,
        })
      }
    } catch {
      // Ignore
    }
    // Socket is already closing or closed; safely close only if still open
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Closed')
      }
    } catch {
      // Ignore
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WS error:', error)
  }
}
