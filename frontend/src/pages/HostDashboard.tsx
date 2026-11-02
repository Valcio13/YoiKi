import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiUpload, getToken, getSessionId, getWsUrl, getApiImageUrl } from '../lib/api'
import GameStatsView from '../components/GameStatsView'

interface Session {
  id: string
  mode: string
  status: string
  current_round: number
  spectator_token?: string
}

interface Participant {
  id: string
  slot: number
  display_name: string
  points: number
  token: string
}

interface Round {
  id: string
  round_number: number
  status: string
}

interface Character {
  id: string
  session_id: string
  round_id: string
  held_by_slot: number
  guessed_by_slot: number
  name: string
  image_key?: string | null
  revealed: number
}

interface Hint {
  id: string
  character_id: string
  sort_order: number
  point_price: number
  text_content: string | null
  has_image: boolean
}

interface PointTx {
  id: string
  participant_id: string
  display_name: string
  delta: number
  reason: string
  created_at: number
}

interface Drawing {
  id: string
  round_id: string
  participant_id: string
  display_name: string
  slot: number
  submitted: number
  submitted_at: number
}

export default function HostDashboard() {
  const token = getToken() || ''
  const sessionId = getSessionId() || ''

  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [_rounds, setRounds] = useState<Round[]>([])
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [hintsByChar, setHintsByChar] = useState<Record<string, Hint[]>>({})
  const [txHistory, setTxHistory] = useState<PointTx[]>([])
  const [drawings, setDrawings] = useState<Drawing[]>([])

  // Live previews from players (participantId -> dataUrl)
  const [livePreviews, setLivePreviews] = useState<Record<string, string>>({})
  const [playerOnline, setPlayerOnline] = useState<Record<string, boolean>>({})

  // Point adjustment form state
  const [customDelta, setCustomDelta] = useState<Record<string, string>>({})
  const [customReason, setCustomReason] = useState<Record<string, string>>({})

  // Character creation modal / form
  const [showCharModal, setShowCharModal] = useState(false)
  const [newCharName, setNewCharName] = useState('')
  const [newCharGuessedBy, setNewCharGuessedBy] = useState<number>(1)
  const [newCharHeldBy, setNewCharHeldBy] = useState<number>(2)
  const [charImageFile, setCharImageFile] = useState<File | null>(null)

  // Hint creation form
  const [hintTargetCharId, setHintTargetCharId] = useState<string | null>(null)
  const [newHintText, setNewHintText] = useState('')
  const [newHintPrice, setNewHintPrice] = useState(15)
  const [hintImageFile, setHintImageFile] = useState<File | null>(null)

  const [showLinksModal, setShowLinksModal] = useState(false)
  const [viewStats, setViewStats] = useState(false)
  const [zoomedPlayerId, setZoomedPlayerId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState<number>(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const wsRef = useRef<WebSocket | null>(null)

  // Keyboard navigation & zoom controls for Fullscreen / Focus Mode
  useEffect(() => {
    if (!zoomedPlayerId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomedPlayerId(null)
      } else if (e.key === '+' || e.key === '=') {
        setZoomLevel(z => Math.min(3, +(z + 0.25).toFixed(2)))
      } else if (e.key === '-' || e.key === '_') {
        setZoomLevel(z => Math.max(0.5, +(z - 0.25).toFixed(2)))
      } else if (e.key === '0') {
        setZoomLevel(1)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Tab') {
        e.preventDefault()
        setParticipants(current => {
          if (current.length < 2) return current
          const idx = current.findIndex(p => p.id === zoomedPlayerId)
          const nextIdx = (idx + 1) % current.length
          setZoomedPlayerId(current[nextIdx].id)
          return current
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [zoomedPlayerId])

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setZoomLevel(z => Math.min(3, +(z + 0.15).toFixed(2)))
    } else {
      setZoomLevel(z => Math.max(0.5, +(z - 0.15).toFixed(2)))
    }
  }

  function toggleBrowserFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // 1. Fetch Session Data
  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch<{ session: Session; participants: Participant[] }>(
        `/sessions/${sessionId}`, {}, token
      )
      setSession(data.session)
      setParticipants(data.participants)

      if (data.session.current_round > 0) {
        const rds = await apiFetch<Round[]>(`/rounds/${sessionId}`, {}, token)
        setRounds(rds)
        const active = rds.find(r => r.round_number === data.session.current_round)
        if (active) {
          setCurrentRound(active)

          // Fetch characters
          const chars = await apiFetch<Character[]>(`/characters/${sessionId}/${active.id}`, {}, token)
          setCharacters(chars)

          // Fetch hints for each character
          const hintsMap: Record<string, Hint[]> = {}
          for (const ch of chars) {
            const hList = await apiFetch<Hint[]>(`/hints/${ch.id}`, {}, token)
            hintsMap[ch.id] = hList
          }
          setHintsByChar(hintsMap)

          // Fetch drawings
          const drws = await apiFetch<Drawing[]>(`/drawings/${active.id}`, {}, token)
          setDrawings(drws)
        }
      }

      // Fetch point tx history
      const txs = await apiFetch<PointTx[]>(`/points/${sessionId}/history`, {}, token)
      setTxHistory(txs)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, token])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  // 2. WebSocket for live drawing streaming
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

        if (msg.type === 'drawing_submitted') {
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

  // 3. Round & Session Management
  async function startNewRound() {
    try {
      await apiFetch('/rounds', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }, token)
      // Broadcast state update
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'round_started' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function updateStatus(status: string) {
    try {
      await apiFetch(`/sessions/${sessionId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }, token)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'status_changed', status }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  // 4. Point Adjustments
  async function adjustPoints(participantId: string, delta: number, reason: string) {
    try {
      await apiFetch('/points', {
        method: 'POST',
        body: JSON.stringify({ participantId, delta, reason }),
      }, token)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'points_adjusted' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  // 5. Character Management
  async function createCharacter() {
    if (!newCharName.trim() || !currentRound) {
      alert('Please enter character name')
      return
    }
    try {
      const res = await apiFetch<{ id: string }>('/characters', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          roundId: currentRound.id,
          name: newCharName.trim(),
          heldBySlot: session?.mode === '1p' ? 0 : newCharHeldBy,
          guessedBySlot: newCharGuessedBy,
        }),
      }, token)

      if (charImageFile) {
        const fd = new FormData()
        fd.append('image', charImageFile)
        await apiUpload(`/characters/${res.id}/image`, fd, token)
      }

      setNewCharName('')
      setCharImageFile(null)
      setShowCharModal(false)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'character_created' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function revealCharacter(characterId: string) {
    try {
      await apiFetch(`/characters/${characterId}/reveal`, { method: 'PATCH' }, token)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'character_revealed' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function deleteCharacter(characterId: string) {
    if (!confirm('Delete this character and its hints?')) return
    try {
      await apiFetch(`/characters/${characterId}`, { method: 'DELETE' }, token)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'character_deleted' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  // 6. Hint Management
  async function createHint() {
    if (!hintTargetCharId || !newHintText.trim()) {
      alert('Please enter hint text')
      return
    }
    try {
      const res = await apiFetch<{ id: string }>('/hints', {
        method: 'POST',
        body: JSON.stringify({
          characterId: hintTargetCharId,
          textContent: newHintText.trim(),
          pointPrice: newHintPrice,
        }),
      }, token)

      if (hintImageFile) {
        const fd = new FormData()
        fd.append('image', hintImageFile)
        await apiUpload(`/hints/${res.id}/image`, fd, token)
      }

      setNewHintText('')
      setHintImageFile(null)
      setHintTargetCharId(null)
      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'hint_created' }))
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function deleteHint(hintId: string) {
    if (!confirm('Delete this hint?')) return
    try {
      await apiFetch(`/hints/${hintId}`, { method: 'DELETE' }, token)
      await fetchData()
    } catch (e: any) {
      alert(e.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-400 text-lg animate-pulse">Loading Host Dashboard...</div>
      </div>
    )
  }

  const origin = window.location.origin
  const isPlaying = session?.status === 'playing'
  const isResults = session?.status === 'results'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top Bar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <span className="text-2xl">👑</span>
          <div>
            <h1 className="font-extrabold text-lg text-indigo-300">Host Dashboard</h1>
            <p className="text-xs text-gray-400">
              Session ID: <span className="font-mono text-gray-300">{sessionId}</span> · Mode: {session?.mode.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewStats(prev => !prev)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition border flex items-center gap-1.5 ${
              viewStats ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-gray-800 hover:bg-gray-700 text-indigo-300 border-gray-700'
            }`}
          >
            <span>📊</span> {viewStats ? 'Live Dashboard' : 'Game Stats'}
          </button>

          <button
            onClick={() => setShowLinksModal(true)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-lg transition border border-gray-700 flex items-center gap-1.5"
          >
            <span>🔗</span> Share Links
          </button>

          <a
            href={`/?token=${session?.spectator_token || ''}&role=spectator&session=${sessionId}`}
            onClick={(e) => {
              e.preventDefault()
              window.open(`/?token=${session?.spectator_token || ''}&role=spectator&session=${sessionId}`, '_blank', 'width=1280,height=720')
            }}
            className="px-3 py-1.5 bg-amber-600/90 hover:bg-amber-500 text-black text-xs font-bold rounded-lg transition shadow flex items-center gap-1.5"
          >
            <span>📺</span> OBS Spectator View
          </a>

          <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
            isPlaying ? 'bg-green-900/80 text-green-300 border border-green-700' :
            isResults ? 'bg-yellow-900/80 text-yellow-300 border border-yellow-700' :
            session?.status === 'ended' ? 'bg-purple-900/80 text-purple-300 border border-purple-700' :
            'bg-gray-800 text-gray-400 border border-gray-700'
          }`}>
            {session?.status} · Round {session?.current_round}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="p-6 max-w-7xl mx-auto w-full space-y-6 flex-1">
        {error && (
          <div className="bg-red-950 border border-red-700 text-red-300 p-4 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* 1. ROUND CONTROL BANNER */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-lg">
          <div>
            <h2 className="font-bold text-base text-gray-200">Round Lifecycle Control</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Current state: <strong className="text-white uppercase">{session?.status}</strong> (Round {session?.current_round})
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {session?.status === 'lobby' && (
              <button
                onClick={startNewRound}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl transition shadow-lg flex items-center gap-2"
              >
                <span>▶️</span> Start Round {((session?.current_round || 0) + 1)}
              </button>
            )}

            {isPlaying && (
              <button
                onClick={() => updateStatus('results')}
                className="px-5 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black font-bold text-sm rounded-xl transition shadow-lg flex items-center gap-2"
              >
                <span>🏁</span> End Round → Show Results
              </button>
            )}

            {isResults && (
              <>
                <button
                  onClick={startNewRound}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition shadow-lg flex items-center gap-2"
                >
                  <span>⏩</span> Next Round ({((session?.current_round || 0) + 1)})
                </button>
                <button
                  onClick={() => updateStatus('lobby')}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm rounded-xl transition"
                >
                  Back to Lobby
                </button>
              </>
            )}

            {session?.status === 'ended' ? (
              <>
                <button
                  onClick={() => setViewStats(true)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl transition shadow-lg flex items-center gap-2"
                >
                  <span>📊</span> View Game Stats
                </button>
                <button
                  onClick={async () => {
                    if (confirm('Restart game session for a new match? Points will reset to 100.')) {
                      await apiFetch(`/sessions/${sessionId}/restart`, { method: 'POST' }, token)
                      wsRef.current?.send(JSON.stringify({ type: 'state_update', action: 'session_restarted' }))
                      setViewStats(false)
                      await fetchData()
                    }
                  }}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-sm rounded-xl transition flex items-center gap-2"
                >
                  <span>🔄</span> Play Again (Reset Points)
                </button>
              </>
            ) : (
              <button
                onClick={async () => {
                  if (confirm('End the entire game session and display game statistics?')) {
                    await updateStatus('ended')
                    setViewStats(true)
                  }
                }}
                className="px-4 py-2 bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 font-medium text-sm rounded-xl transition flex items-center gap-1.5"
              >
                <span>🏁</span> End Game
              </button>
            )}
          </div>
        </div>

        {/* GAME STATS DISPLAY */}
        {(viewStats || session?.status === 'ended') && (
          <GameStatsView
            sessionId={sessionId}
            isHost={true}
            onClose={() => setViewStats(false)}
            onRestart={() => {
              setViewStats(false)
              fetchData()
            }}
          />
        )}

        {/* 2. LIVE SPECTATOR: DUAL CANVAS DISPLAY */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg text-indigo-300 flex items-center gap-2">
              <span>📡</span> Live Drawing Spectator
            </h2>
            <span className="text-xs text-gray-400">Updates live via WebSocket</span>
          </div>

          <div className={`grid grid-cols-1 ${session?.mode === '2p' ? 'md:grid-cols-2' : ''} gap-6`}>
            {participants.map((p) => {
              const preview = livePreviews[p.id]
              const isOnline = playerOnline[p.id] !== false
              const drawingSub = drawings.find(d => d.participant_id === p.id && d.submitted === 1)

              return (
                <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl flex flex-col">
                  {/* Player Canvas Header */}
                  <div className="bg-gray-800/80 px-4 py-3 flex items-center justify-between border-b border-gray-750">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-600'}`} />
                      <span className="font-bold text-sm text-white">{p.display_name}</span>
                      <span className="text-xs text-gray-400">(Slot {p.slot})</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setZoomedPlayerId(p.id)
                          setZoomLevel(1)
                        }}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-indigo-600 text-gray-300 hover:text-white rounded-lg transition text-xs font-semibold flex items-center gap-1.5 border border-gray-700 hover:border-indigo-500 shadow-sm"
                        title="Zoom In / Fullscreen View"
                      >
                        <span>⛶</span> Fullscreen
                      </button>

                      {drawingSub && (
                        <span className="bg-emerald-950 text-emerald-300 border border-emerald-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                          Submitted
                        </span>
                      )}
                      <span className="font-mono text-sm font-bold text-yellow-400">{p.points} pts</span>
                    </div>
                  </div>

                  {/* Canvas Viewport */}
                  <div
                    onClick={() => {
                      setZoomedPlayerId(p.id)
                      setZoomLevel(1)
                    }}
                    className="relative aspect-4/3 bg-black flex items-center justify-center overflow-hidden cursor-zoom-in group"
                    title="Click to Zoom In / Fullscreen"
                  >
                    {/* Hover zoom indicator */}
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white border border-gray-700 pointer-events-none flex items-center gap-1.5 z-10 shadow-lg">
                      <span>🔍</span> Click to Zoom
                    </div>
                    {preview ? (
                      <img
                        src={preview}
                        alt={`${p.display_name} drawing`}
                        className="w-full h-full object-contain"
                      />
                    ) : drawingSub ? (
                      <img
                        src={getApiImageUrl(`/drawings/image/${drawingSub.id}`, token)}
                        alt={`${p.display_name} final drawing`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-gray-600 p-6">
                        <div className="text-4xl mb-2 opacity-50">🖌️</div>
                        <p className="text-sm font-medium">Waiting for drawing input...</p>
                        <p className="text-xs text-gray-500 mt-1">Player canvas will appear live here</p>
                      </div>
                    )}
                  </div>

                  {/* Quick Award Bar */}
                  <div className="p-3 bg-gray-900 border-t border-gray-800 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-gray-400">Award Points:</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => adjustPoints(p.id, 10, 'Good Guess / Clue')}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-green-400 rounded-lg text-xs font-semibold"
                      >+10</button>
                      <button
                        onClick={() => adjustPoints(p.id, 25, 'Great Performance')}
                        className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-green-400 rounded-lg text-xs font-semibold"
                      >+25</button>
                      <button
                        onClick={() => adjustPoints(p.id, 50, 'Round Winner!')}
                        className="px-3 py-1 bg-indigo-900 hover:bg-indigo-800 text-indigo-300 rounded-lg text-xs font-bold border border-indigo-700"
                      >+50 🏆 Winner</button>
                      <button
                        onClick={() => adjustPoints(p.id, -10, 'Penalty / Correction')}
                        className="px-2 py-1 bg-gray-800 hover:bg-red-950 text-red-400 rounded-lg text-xs"
                      >-10</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 3. SECRET CHARACTERS & HINT SHOP CONFIG */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg text-white flex items-center gap-2">
                <span>🎭</span> Characters & Hints for Round {session?.current_round || 1}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Assign secret characters to players and prepare point-priced hints.
              </p>
            </div>

            {currentRound && (
              <button
                onClick={() => setShowCharModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow flex items-center gap-1.5"
              >
                <span>➕</span> Add Secret Character
              </button>
            )}
          </div>

          {!currentRound ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              Start Round 1 above to assign characters and create hints.
            </div>
          ) : characters.length === 0 ? (
            <div className="text-center py-8 bg-gray-950/60 rounded-xl border border-dashed border-gray-800">
              <p className="text-gray-400 text-sm mb-3">No secret characters assigned yet for this round.</p>
              <button
                onClick={() => setShowCharModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg"
              >
                Create Character Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {characters.map((ch) => {
                const holder = participants.find(p => p.slot === ch.held_by_slot)
                const guesser = participants.find(p => p.slot === ch.guessed_by_slot)
                const chHints = hintsByChar[ch.id] || []

                return (
                  <div key={ch.id} className="bg-gray-950 border border-gray-800 rounded-xl p-5 flex flex-col space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider block">
                          Must be guessed by {guesser?.display_name || `Player ${ch.guessed_by_slot}`}
                        </span>
                        <h3 className="text-xl font-black text-white mt-0.5 flex items-center gap-2">
                          {ch.name}
                          {ch.revealed === 1 && (
                            <span className="text-xs px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded font-semibold">
                              Revealed
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">
                          Held by: <strong className="text-gray-300">{ch.held_by_slot === 0 ? 'Host' : holder?.display_name || `Slot ${ch.held_by_slot}`}</strong>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {ch.revealed === 0 && isResults && (
                          <button
                            onClick={() => revealCharacter(ch.id)}
                            className="px-2.5 py-1 bg-yellow-600 hover:bg-yellow-500 text-black rounded text-xs font-bold"
                          >
                            Reveal Answer
                          </button>
                        )}
                        <button
                          onClick={() => deleteCharacter(ch.id)}
                          className="text-gray-500 hover:text-red-400 text-xs p-1"
                          title="Delete character"
                        >✕</button>
                      </div>
                    </div>

                    {/* Image if uploaded */}
                    {ch.image_key && (
                      <div className="rounded-lg overflow-hidden border border-gray-800 bg-black/60 max-h-40 flex items-center justify-center">
                        <img
                          src={getApiImageUrl(`/characters/${ch.id}/image`, token)}
                          alt={ch.name}
                          className="max-h-40 w-auto object-contain"
                        />
                      </div>
                    )}

                    {/* Hints Section */}
                    <div className="border-t border-gray-850 pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-300">Hints ({chHints.length})</span>
                        <button
                          onClick={() => setHintTargetCharId(ch.id)}
                          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1"
                        >
                          + Add Hint
                        </button>
                      </div>

                      {chHints.length === 0 ? (
                        <p className="text-xs text-gray-500 italic">No hints added yet for this character.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {chHints.map((hint, hIdx) => (
                            <div key={hint.id} className="bg-gray-900 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 border border-gray-800">
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-gray-500 font-mono">#{hIdx + 1}</span>
                                <span className="text-gray-200 truncate">{hint.text_content || '(Image clue)'}</span>
                                {hint.has_image && <span className="text-xs text-amber-400">🖼️</span>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-yellow-400 font-semibold">{hint.point_price} pts</span>
                                <button
                                  onClick={() => deleteHint(hint.id)}
                                  className="text-gray-500 hover:text-red-400"
                                >✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 4. POINT BALANCES & AUDIT TRAIL */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Custom Point Adjustment */}
          <div className="md:col-span-5 bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl">
            <h2 className="font-bold text-base text-white mb-3 flex items-center gap-2">
              <span>⚖️</span> Manual Point Adjustments
            </h2>

            <div className="space-y-4">
              {participants.map((p) => (
                <div key={p.id} className="bg-gray-950 p-3.5 rounded-xl border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm text-gray-200">{p.display_name}</span>
                    <span className="text-yellow-400 font-mono font-bold text-sm">{p.points} pts</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input
                      type="number"
                      placeholder="Amount (+ or -)"
                      value={customDelta[p.id] || ''}
                      onChange={(e) => setCustomDelta(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="text"
                      placeholder="Reason"
                      value={customReason[p.id] || ''}
                      onChange={(e) => setCustomReason(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>

                  <button
                    onClick={() => {
                      const d = parseInt(customDelta[p.id] || '0')
                      if (d !== 0) {
                        adjustPoints(p.id, d, customReason[p.id] || 'Host adjustment')
                        setCustomDelta(prev => ({ ...prev, [p.id]: '' }))
                        setCustomReason(prev => ({ ...prev, [p.id]: '' }))
                      }
                    }}
                    className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-semibold transition"
                  >
                    Apply Adjustment
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Point History Log */}
          <div className="md:col-span-7 bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl flex flex-col">
            <h2 className="font-bold text-base text-white mb-3 flex items-center gap-2">
              <span>📜</span> Point Transaction History
            </h2>

            {txHistory.length === 0 ? (
              <div className="text-center py-10 text-gray-500 text-xs flex-1 flex items-center justify-center">
                No point transactions recorded yet.
              </div>
            ) : (
              <div className="space-y-1.5 overflow-y-auto max-h-72 flex-1 pr-1">
                {txHistory.map((tx) => (
                  <div key={tx.id} className="bg-gray-950 px-3 py-2 rounded-lg text-xs flex items-center justify-between border border-gray-850">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-300">{tx.display_name}</span>
                      <span className="text-gray-400">({tx.reason})</span>
                    </div>
                    <span className={`font-mono font-bold ${tx.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.delta >= 0 ? `+${tx.delta}` : tx.delta} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* MODAL 1: ADD SECRET CHARACTER */}
      {showCharModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">Add Secret Character</h3>
              <button onClick={() => setShowCharModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Character Name</label>
              <input
                type="text"
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                placeholder="e.g. Mario, Batman, Pikachu"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            {session?.mode === '2p' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Guessed By</label>
                  <select
                    value={newCharGuessedBy}
                    onChange={(e) => {
                      const g = parseInt(e.target.value)
                      setNewCharGuessedBy(g)
                      setNewCharHeldBy(g === 1 ? 2 : 1)
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    {participants.map(p => (
                      <option key={p.id} value={p.slot}>{p.display_name} (Slot {p.slot})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1">Held By (Answers Qs)</label>
                  <select
                    value={newCharHeldBy}
                    disabled
                    className="w-full bg-gray-850 border border-gray-750 rounded-lg px-3 py-2 text-sm text-gray-400"
                  >
                    {participants.map(p => (
                      <option key={p.id} value={p.slot}>{p.display_name} (Slot {p.slot})</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                In 1-Player mode, you (the Host) hold the character and answer questions verbally.
              </p>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Optional Reference Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCharImageFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-800 file:text-indigo-300 hover:file:bg-gray-700"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowCharModal(false)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300"
              >Cancel</button>
              <button
                onClick={createCharacter}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold text-white shadow"
              >Save Character</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD HINT */}
      {hintTargetCharId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">Add Hint for Character</h3>
              <button onClick={() => setHintTargetCharId(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Hint Text Clue</label>
              <textarea
                value={newHintText}
                onChange={(e) => setNewHintText(e.target.value)}
                placeholder="e.g. Has a red hat with an M on it"
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Point Price (Deducted from Player)</label>
              <input
                type="number"
                min={0}
                value={newHintPrice}
                onChange={(e) => setNewHintPrice(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1">Optional Clue Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setHintImageFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-800 file:text-indigo-300 hover:file:bg-gray-700"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setHintTargetCharId(null)}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300"
              >Cancel</button>
              <button
                onClick={createHint}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold text-white shadow"
              >Save Hint</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: SHARE LINKS */}
      {showLinksModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-white">Session Invitation Links</h3>
              <button onClick={() => setShowLinksModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-3">
              {participants.map(p => (
                <div key={p.id}>
                  <p className="text-xs font-semibold text-green-400 uppercase mb-1">{p.display_name} Link</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={`${origin}?token=${p.token}&role=player&session=${sessionId}`}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 font-mono"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(`${origin}?token=${p.token}&role=player&session=${sessionId}`)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-semibold"
                    >Copy</button>
                  </div>
                </div>
              ))}

              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs font-semibold text-amber-400 uppercase mb-1">OBS Spectator View Link</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={`${origin}?token=${session?.spectator_token || ''}&role=spectator&session=${sessionId}`}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 font-mono"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(`${origin}?token=${session?.spectator_token || ''}&role=spectator&session=${sessionId}`)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-semibold"
                  >Copy</button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowLinksModal(false)}
              className="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-200 mt-2 font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* 4. FULLSCREEN / ZOOM PLAYER VIEW MODAL */}
      {(() => {
        const zoomedPlayer = participants.find(p => p.id === zoomedPlayerId)
        if (!zoomedPlayer) return null
        const zoomedPreview = livePreviews[zoomedPlayer.id]
        const zoomedDrawingSub = drawings.find(d => d.participant_id === zoomedPlayer.id && d.submitted === 1)
        const isZoomedOnline = playerOnline[zoomedPlayer.id] !== false

        return (
          <div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col select-none animate-in fade-in duration-150"
            onWheel={handleWheel}
          >
            {/* Header */}
            <div className="bg-zinc-950/90 border-b border-zinc-800 px-6 py-3.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${isZoomedOnline ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                <div>
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    {zoomedPlayer.display_name}
                    <span className="text-xs px-2.5 py-0.5 bg-zinc-800 text-zinc-300 font-semibold rounded-full border border-zinc-700">
                      Slot {zoomedPlayer.slot}
                    </span>
                    {zoomedDrawingSub && (
                      <span className="text-xs px-2.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold rounded-full">
                        ✓ Drawing Submitted
                      </span>
                    )}
                  </h3>
                </div>
              </div>

              {/* Player Switching Bar (if mode is 2P) */}
              {participants.length > 1 && (
                <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
                  {participants.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setZoomedPlayerId(p.id)
                        setZoomLevel(1)
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                        p.id === zoomedPlayer.id
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      <span>{p.id === zoomedPlayer.id ? '👁️' : '👤'}</span>
                      {p.display_name}
                    </button>
                  ))}
                </div>
              )}

              {/* Zoom Controls & Close */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 text-xs">
                  <button
                    onClick={() => setZoomLevel(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                    className="px-2.5 py-1 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded font-bold"
                    title="Zoom Out (-)"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setZoomLevel(1)}
                    className="px-2.5 py-1 text-indigo-300 font-mono font-bold hover:bg-zinc-800 rounded"
                    title="Reset to 100% (0)"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </button>
                  <button
                    onClick={() => setZoomLevel(z => Math.min(3, +(z + 0.25).toFixed(2)))}
                    className="px-2.5 py-1 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded font-bold"
                    title="Zoom In (+)"
                  >
                    +
                  </button>
                </div>

                <button
                  onClick={toggleBrowserFullscreen}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold rounded-xl transition flex items-center gap-1"
                  title="Toggle Monitor Fullscreen"
                >
                  <span>⛶</span> Fullscreen
                </button>

                <button
                  onClick={() => setZoomedPlayerId(null)}
                  className="px-3.5 py-1.5 bg-zinc-800 hover:bg-red-900/80 text-zinc-300 hover:text-red-200 text-xs font-bold rounded-xl transition flex items-center gap-1 border border-zinc-700"
                  title="Exit Zoom (Esc)"
                >
                  <span>✕</span> Close
                </button>
              </div>
            </div>

            {/* Canvas Viewport (Zoomable Area) */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-6 relative">
              <div
                className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-150 ease-out"
                style={{ transform: `scale(${zoomLevel})` }}
              >
                {zoomedPreview ? (
                  <img
                    src={zoomedPreview}
                    alt={`${zoomedPlayer.display_name} live drawing`}
                    className="max-w-[88vw] max-h-[76vh] w-auto h-auto object-contain rounded-2xl shadow-2xl border border-zinc-800 bg-black"
                  />
                ) : zoomedDrawingSub ? (
                  <img
                    src={getApiImageUrl(`/drawings/image/${zoomedDrawingSub.id}`, token)}
                    alt={`${zoomedPlayer.display_name} final drawing`}
                    className="max-w-[88vw] max-h-[76vh] w-auto h-auto object-contain rounded-2xl shadow-2xl border border-zinc-800 bg-black"
                  />
                ) : (
                  <div className="text-center text-zinc-600 p-12 bg-zinc-950 rounded-2xl border border-zinc-800">
                    <div className="text-6xl mb-3 opacity-40">🖌️</div>
                    <p className="text-lg font-bold text-zinc-400">Waiting for {zoomedPlayer.display_name}&apos;s drawing input...</p>
                    <p className="text-xs text-zinc-600 mt-1">Live strokes will stream in real-time</p>
                  </div>
                )}
              </div>
            </div>

            {/* Fullscreen Scoring Bar */}
            <div className="bg-zinc-950/95 border-t border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  {zoomedPlayer.display_name}&apos;s Score:
                </span>
                <span className="text-2xl font-black text-yellow-400 font-mono">
                  {zoomedPlayer.points} <span className="text-xs font-medium text-zinc-500">PTS</span>
                </span>
              </div>

              {/* Quick Points Award */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 mr-1">Award Points:</span>
                <button
                  onClick={() => adjustPoints(zoomedPlayer.id, 10, 'Good Guess / Clue')}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-emerald-950 text-emerald-400 border border-zinc-800 hover:border-emerald-700 rounded-xl text-xs font-bold transition shadow"
                >
                  +10
                </button>
                <button
                  onClick={() => adjustPoints(zoomedPlayer.id, 25, 'Great Performance')}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-emerald-950 text-emerald-400 border border-zinc-800 hover:border-emerald-700 rounded-xl text-xs font-bold transition shadow"
                >
                  +25
                </button>
                <button
                  onClick={() => adjustPoints(zoomedPlayer.id, 50, 'Round Winner!')}
                  className="px-4 py-1.5 bg-indigo-900 hover:bg-indigo-800 text-indigo-200 border border-indigo-700 rounded-xl text-xs font-black transition shadow"
                >
                  +50 🏆 Winner
                </button>
                <button
                  onClick={() => adjustPoints(zoomedPlayer.id, -10, 'Penalty / Correction')}
                  className="px-2.5 py-1.5 bg-zinc-900 hover:bg-red-950 text-red-400 border border-zinc-800 hover:border-red-800 rounded-xl text-xs font-semibold transition"
                >
                  -10
                </button>
              </div>

              {/* Shortcuts help */}
              <div className="text-xs text-zinc-500 hidden md:block">
                <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 font-mono text-[11px]">Esc</kbd> Exit · <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 font-mono text-[11px]">← / → / Tab</kbd> Switch Player · <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 font-mono text-[11px]">Scroll / +/-</kbd> Zoom
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
