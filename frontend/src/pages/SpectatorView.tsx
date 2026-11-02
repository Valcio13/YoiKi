import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, getToken, getSessionId, getWsUrl } from '../lib/api'
import GameStatsView from '../components/GameStatsView'

interface Participant {
  id: string
  slot: number
  display_name: string
  points: number
}

interface Session {
  id: string
  mode: string
  status: string
  current_round: number
}

interface Character {
  id: string
  round_id: string
  held_by_slot: number
  guessed_by_slot: number
  name: string
  revealed: number
  image_key?: string | null
}

interface Drawing {
  id: string
  round_id: string
  participant_id: string
  submitted: number
}

export default function SpectatorView() {
  const token = getToken() || ''
  const sessionId = getSessionId() || ''

  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [revealedChars, setRevealedChars] = useState<Character[]>([])
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [livePreviews, setLivePreviews] = useState<Record<string, string>>({})
  const [playerOnline, setPlayerOnline] = useState<Record<string, boolean>>({})

  const wsRef = useRef<WebSocket | null>(null)

  const fetchData = useCallback(async () => {
    if (!sessionId) return
    try {
      const data = await apiFetch<{ session: Session; participants: Participant[] }>(
        `/sessions/${sessionId}`, {}, token
      )
      setSession(data.session)
      setParticipants(data.participants)

      if (data.session.current_round > 0) {
        // Fetch rounds to get current round ID
        const rounds = await apiFetch<any[]>(`/rounds/${sessionId}`, {}, token)
        const active = rounds.find(r => r.round_number === data.session.current_round)
        if (active) {
          // If in results, fetch revealed characters
          const chars = await apiFetch<Character[]>(`/characters/${sessionId}/${active.id}`, {}, token)
          setRevealedChars(chars.filter(c => c.revealed === 1))

          // Fetch drawings if in results
          if (data.session.status === 'results' || data.session.status === 'ended') {
            const drws = await apiFetch<Drawing[]>(`/drawings/${active.id}`, {}, token)
            setDrawings(drws)
          }
        }
      }
    } catch {
      // Ignore
    }
  }, [sessionId, token])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  // WebSocket for real-time live preview capture
  useEffect(() => {
    if (!sessionId || !token) return
    const wsUrl = getWsUrl(sessionId, token)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'preview' && msg.participantId && msg.data) {
          setLivePreviews(prev => ({
            ...prev,
            [msg.participantId]: msg.data,
          }))
        }
        if (msg.type === 'player_status') {
          setPlayerOnline(prev => ({
            ...prev,
            [msg.participantId]: msg.online,
          }))
        }
        if (msg.type === 'state_update') {
          fetchData()
        }
      } catch {
        // Ignore
      }
    }

    return () => {
      ws.close()
    }
  }, [sessionId, token, fetchData])

  const sortedParticipants = [...participants].sort((a, b) => a.slot - b.slot)
  const isPlaying = session?.status === 'playing'
  const isResults = session?.status === 'results' || session?.status === 'ended'

  return (
    <div className="min-h-screen bg-black text-white p-6 flex flex-col justify-between font-sans select-none overflow-hidden">
      
      {/* Broadcast Header (OBS safe) */}
      <header className="flex items-center justify-between pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎨</span>
          <div>
            <h1 className="text-2xl font-black tracking-wider text-indigo-400 uppercase">
              Guess &amp; Draw
            </h1>
            <p className="text-xs text-zinc-500 font-medium tracking-widest uppercase">
              OBS Live Broadcast Overlay
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-zinc-900 border border-zinc-800 px-4 py-1.5 rounded-full flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-zinc-600'}`} />
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-300">
              {isPlaying ? '🔴 LIVE DRAWING' : session?.status?.toUpperCase()}
            </span>
          </div>

          <div className="bg-indigo-950/80 border border-indigo-700/60 px-4 py-1.5 rounded-full">
            <span className="text-xs font-black text-indigo-300 tracking-wider">
              ROUND {session?.current_round || 0}
            </span>
          </div>
        </div>
      </header>

      {/* Main Stage: Player Canvases OR Final Game Stats */}
      {session?.status === 'ended' ? (
        <main className="flex-1 my-6 overflow-y-auto px-4 max-w-6xl mx-auto w-full">
          <GameStatsView sessionId={sessionId} isHost={false} />
        </main>
      ) : (
        <main className="flex-1 my-6 flex items-center justify-center">
          <div className={`w-full max-w-7xl grid grid-cols-1 ${session?.mode === '2p' ? 'md:grid-cols-2' : 'max-w-3xl'} gap-8`}>
            {sortedParticipants.map((p) => {
              const preview = livePreviews[p.id]
              const isOnline = playerOnline[p.id] !== false
              const drawingSub = drawings.find(d => d.participant_id === p.id && d.submitted === 1)
              // If in results and revealed, find the character this player was guessing
              const guessedChar = revealedChars.find(c => c.guessed_by_slot === p.slot)

              return (
                <div
                  key={p.id}
                  className="bg-zinc-950 border-2 border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
                >
                  {/* Player Card Header */}
                  <div className="bg-zinc-900/90 px-6 py-4 flex items-center justify-between border-b border-zinc-800">
                    <div className="flex items-center gap-3">
                      <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                      <span className="text-xl font-black text-white tracking-wide">
                        {p.display_name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 bg-black/60 px-3.5 py-1 rounded-full border border-zinc-800">
                      <span className="text-2xl font-black text-yellow-400 tracking-tight font-mono">
                        {p.points}
                      </span>
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                        PTS
                      </span>
                    </div>
                  </div>

                  {/* Canvas Display Viewport */}
                  <div className="relative aspect-4/3 bg-black flex items-center justify-center overflow-hidden">
                    {preview ? (
                      <img
                        src={preview}
                        alt={`${p.display_name} drawing`}
                        className="w-full h-full object-contain"
                      />
                    ) : drawingSub ? (
                      <img
                        src={`/api/drawings/image/${drawingSub.id}`}
                        alt={`${p.display_name} final drawing`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-zinc-700 p-8">
                        <div className="text-5xl mb-2 opacity-40">🖌️</div>
                        <p className="text-sm font-semibold text-zinc-500">Live Canvas Ready</p>
                      </div>
                    )}
                  </div>

                  {/* Results Reveal Banner (Only visible when revealed in Results phase) */}
                  {isResults && guessedChar && (
                    <div className="bg-indigo-950/90 border-t border-indigo-800/80 p-4 text-center">
                      <p className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-1">
                        Target Answer Revealed
                      </p>
                      <p className="text-2xl font-black text-yellow-300 tracking-wide">
                        {guessedChar.name}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </main>
      )}

      {/* Broadcast Footer */}
      <footer className="text-center text-zinc-600 text-xs font-medium tracking-widest uppercase pt-3 border-t border-zinc-900">
        Guess &amp; Draw · Verbal Q&amp;A Multiplayer Game
      </footer>

    </div>
  )
}
