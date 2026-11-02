import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiUpload, getToken, getSessionId, getWsUrl } from '../lib/api'
import GameStatsView from '../components/GameStatsView'

interface Participant {
  id: string
  session_id: string
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
  has_image: boolean
  purchased: boolean
  text_content: string | null
}

interface Round {
  id: string
  round_number: number
  status: string
}

export default function PlayerRoom() {
  const token = getToken() || ''
  const sessionId = getSessionId() || ''

  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [opponentName, setOpponentName] = useState<string>('Opponent')

  const [heldCharacter, setHeldCharacter] = useState<Character | null>(null)
  const [_guessTargetCharId, setGuessTargetCharId] = useState<string | null>(null)
  const [revealedGuessChar, setRevealedGuessChar] = useState<Character | null>(null)

  const [hints, setHints] = useState<Hint[]>([])
  const [purchasingHintId, setPurchasingHintId] = useState<string | null>(null)

  const [submittedDrawing, setSubmittedDrawing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lastSnapshotRef = useRef<string>('')

  // 1. Fetch player & session data
  const fetchData = useCallback(async () => {
    try {
      const [me, sessionData] = await Promise.all([
        apiFetch<Participant>('/participants/me', {}, token),
        apiFetch<{ session: Session; participants?: Participant[]; self?: Participant }>(
          `/sessions/${sessionId}`, {}, token
        ),
      ])
      setParticipant(me)
      setSession(sessionData.session)

      // Get opponent display name if available
      if (sessionData.participants) {
        const opp = sessionData.participants.find(p => p.id !== me.id)
        if (opp) setOpponentName(opp.display_name)
      }

      // If active round
      if (sessionData.session.current_round > 0) {
        const rounds = await apiFetch<Round[]>(`/rounds/${sessionId}`, {}, token)
        const active = rounds.find(r => r.round_number === sessionData.session.current_round)
        if (active) {
          setCurrentRound(active)

          // Fetch characters for this round
          const chars = await apiFetch<Character[]>(`/characters/${sessionId}/${active.id}`, {}, token)
          
          // Character player is holding
          const held = chars.find(c => c.held_by_slot === me.slot)
          setHeldCharacter(held || null)

          // Character player is guessing
          const guessing = chars.find(c => c.guessed_by_slot === me.slot)
          if (guessing) {
            setGuessTargetCharId(guessing.id)
            if (guessing.revealed === 1 || sessionData.session.status === 'results') {
              setRevealedGuessChar(guessing)
            } else {
              setRevealedGuessChar(null)
            }

            // Fetch hints for this character
            const hList = await apiFetch<Hint[]>(`/hints/${guessing.id}`, {}, token)
            setHints(hList)
          }

          // Check if drawing was submitted
          const drawings = await apiFetch<any[]>(`/drawings/${active.id}`, {}, token)
          const myDraw = drawings.find((d: any) => d.participant_id === me.id)
          setSubmittedDrawing(!!myDraw?.submitted)
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, sessionId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  // 2. WebSocket for live snapshot streaming & updates
  useEffect(() => {
    if (!sessionId || !token) return
    const wsUrl = getWsUrl(sessionId, token)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
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

  // 3. Periodic canvas snapshot capture and transmission via WebSocket
  useEffect(() => {
    if (!session || session.status !== 'playing' || submittedDrawing) return

    const timer = setInterval(() => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'klecks:request-snapshot' }, '*')
      }
    }, 2500)

    return () => clearInterval(timer)
  }, [session, submittedDrawing])

  // 4. Handle messages from Klecks iframe
  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return

      // Handle snapshot data
      if (data.type === 'klecks:snapshot-data' && data.dataUrl) {
        const snap = data.dataUrl
        // Only send if changed
        if (snap !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snap
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'preview',
              data: snap,
            }))
          }
        }
      }

      // Handle drawing submission
      if (data.type === 'klecks:submit' && data.blob) {
        if (!currentRound) return
        setSubmitting(true)
        try {
          const formData = new FormData()
          formData.append('drawing', data.blob, 'drawing.png')
          formData.append('roundId', currentRound.id)

          await apiUpload('/drawings/submit', formData, token)
          setSubmittedDrawing(true)

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'drawing_submitted' }))
          }
        } catch (err: any) {
          alert('Submission error: ' + err.message)
        } finally {
          setSubmitting(false)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [currentRound, token])

  // 5. Purchase hint
  async function purchaseHint(hintId: string) {
    setPurchasingHintId(hintId)
    try {
      const res = await apiFetch<any>(`/hints/${hintId}/purchase`, { method: 'POST' }, token)
      if (res.ok) {
        // Refresh hints and participant balance
        await fetchData()
      }
    } catch (e: any) {
      alert(e.message || 'Failed to purchase hint')
    } finally {
      setPurchasingHintId(null)
    }
  }

  function handleClearCanvas() {
    if (confirm('Are you sure you want to clear your drawing?')) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'klecks:clear' }, '*')
    }
  }

  function handleSubmitClick() {
    if (confirm('Submit this drawing as your final answer for the round?')) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'klecks:request-submit' }, '*')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-400 text-lg animate-pulse">Joining game room...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 p-6">
        <div className="bg-red-950 border border-red-700 text-red-300 p-6 rounded-xl max-w-md text-center">
          <p className="font-semibold mb-2">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  const isPlaying = session?.status === 'playing'
  const isResults = session?.status === 'results'
  const isEnded = session?.status === 'ended'
  const draftKey = `gd_draft_${sessionId}_${participant?.id}_round_${session?.current_round}`

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top Bar */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎨</span>
          <div>
            <h1 className="font-bold text-lg text-white leading-tight">
              {participant?.display_name}
            </h1>
            <p className="text-xs text-gray-400">
              Player Slot {participant?.slot} {session?.mode === '2p' ? `· Playing vs ${opponentName}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs text-gray-400 block">Balance</span>
            <span className="text-xl font-bold text-yellow-400">{participant?.points} pts</span>
          </div>

          <div className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
            isPlaying ? 'bg-green-900/80 text-green-300 border border-green-700' :
            isResults ? 'bg-yellow-900/80 text-yellow-300 border border-yellow-700' :
            isEnded ? 'bg-purple-900/80 text-purple-300 border border-purple-700' :
            'bg-gray-800 text-gray-400'
          }`}>
            {isPlaying ? `Round ${session?.current_round} Live` :
             isResults ? 'Round Results' :
             isEnded ? 'Game Over' : 'Lobby'}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      {isEnded ? (
        <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
          <GameStatsView sessionId={sessionId} isHost={false} />
        </main>
      ) : (
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN: Secret Cards & Hint Shop (5 cols) */}
        <div className="lg:col-span-5 space-y-5 flex flex-col">
          
          {/* CARD 1: THE SECRET CHARACTER YOU ARE HOLDING */}
          <div className="bg-gradient-to-br from-emerald-950/60 to-gray-900 border-2 border-emerald-600/80 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-emerald-500/40">
                🛡️ Secret You Hold
              </span>
              <span className="text-xs text-gray-400">For {opponentName} to guess</span>
            </div>

            {heldCharacter ? (
              <div className="space-y-3">
                <div className="bg-gray-900/90 rounded-xl p-4 border border-emerald-800/40 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Target Answer</p>
                  <p className="text-2xl font-black text-emerald-300 tracking-wide">{heldCharacter.name}</p>
                </div>

                {heldCharacter.image_key && (
                  <div className="rounded-xl overflow-hidden border border-emerald-800/40 bg-black/40 flex items-center justify-center max-h-48">
                    <img
                      src={`/api/characters/${heldCharacter.id}/image`}
                      alt={heldCharacter.name}
                      className="max-h-48 w-auto object-contain"
                    />
                  </div>
                )}

                <div className="bg-emerald-950/40 rounded-lg p-3 text-xs text-emerald-200/90 leading-relaxed border border-emerald-800/20">
                  <span className="font-bold">Instructions:</span> {opponentName} will ask you questions verbally. Answer honestly with "Yes", "No", or descriptions — do NOT say the name!
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm">
                No secret character assigned to you for this round yet.
              </div>
            )}
          </div>

          {/* CARD 2: THE CHARACTER YOU ARE GUESSING & HINT SHOP */}
          <div className="bg-gradient-to-br from-indigo-950/60 to-gray-900 border-2 border-indigo-600/80 rounded-2xl p-5 shadow-lg flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="bg-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-indigo-500/40">
                🎯 Character You Must Guess
              </span>
              <span className="text-xs text-yellow-400 font-semibold">{participant?.points} pts available</span>
            </div>

            <div className="bg-gray-900/80 rounded-xl p-3 mb-4 border border-indigo-800/40 text-center">
              {revealedGuessChar ? (
                <div>
                  <p className="text-xs text-yellow-400 uppercase tracking-widest mb-1">Revealed Answer</p>
                  <p className="text-2xl font-black text-white">{revealedGuessChar.name}</p>
                  {revealedGuessChar.image_key && (
                    <img
                      src={`/api/characters/${revealedGuessChar.id}/image`}
                      alt={revealedGuessChar.name}
                      className="mt-2 max-h-40 mx-auto rounded object-contain"
                    />
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-indigo-300 font-medium">
                    Ask {opponentName} verbal questions to identify your character!
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Draw what you think it looks like on your canvas.
                  </p>
                </div>
              )}
            </div>

            {/* Hint Shop */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm text-indigo-200 flex items-center gap-1.5">
                  <span>💡</span> Hint Shop
                </h3>
                <span className="text-xs text-gray-400">Unlock clues with points</span>
              </div>

              {hints.length === 0 ? (
                <div className="bg-gray-900/50 rounded-xl p-4 text-center text-xs text-gray-500 flex-1 flex items-center justify-center">
                  No hints created for this round.
                </div>
              ) : (
                <div className="space-y-2.5 overflow-y-auto max-h-72 pr-1">
                  {hints.map((hint, idx) => (
                    <div
                      key={hint.id}
                      className={`p-3 rounded-xl border transition ${
                        hint.purchased
                          ? 'bg-indigo-950/40 border-indigo-600/60'
                          : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-300">
                          Hint #{idx + 1} {hint.has_image ? '🖼️ (Image)' : '📝 (Text)'}
                        </span>

                        {hint.purchased ? (
                          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                            <span>✓</span> Unlocked
                          </span>
                        ) : (
                          <button
                            onClick={() => purchaseHint(hint.id)}
                            disabled={purchasingHintId === hint.id || (participant?.points ?? 0) < hint.point_price || !isPlaying}
                            className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 disabled:hover:bg-yellow-600 text-black font-bold text-xs rounded-lg transition shadow"
                          >
                            {purchasingHintId === hint.id ? 'Buying...' : `Buy for ${hint.point_price} pts`}
                          </button>
                        )}
                      </div>

                      {hint.purchased && (
                        <div className="mt-2 pt-2 border-t border-indigo-900/60">
                          {hint.text_content && (
                            <p className="text-sm text-indigo-100 font-medium">{hint.text_content}</p>
                          )}
                          {hint.has_image && (
                            <div className="mt-2 rounded-lg overflow-hidden border border-indigo-800/40 bg-black/40">
                              <img
                                src={`/api/hints/${hint.id}/image`}
                                alt={`Hint ${idx + 1}`}
                                className="max-h-40 w-auto mx-auto object-contain"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* RIGHT COLUMN: Klecks Drawing Editor (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-3">
          
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex-1 flex flex-col shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🖌️</span>
                <h2 className="font-bold text-base text-white">Your Drawing Canvas</h2>
                {submittedDrawing && (
                  <span className="px-2 py-0.5 bg-emerald-900/80 text-emerald-300 text-xs rounded-full border border-emerald-700">
                    Drawing Submitted
                  </span>
                )}
              </div>

              {isPlaying && !submittedDrawing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClearCanvas}
                    className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition"
                  >
                    Clear Canvas
                  </button>
                  <button
                    onClick={handleSubmitClick}
                    disabled={submitting}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition shadow"
                  >
                    {submitting ? 'Submitting...' : '✓ Submit Final Drawing'}
                  </button>
                </div>
              )}
            </div>

            {/* Embedded Klecks Drawing Area */}
            {isPlaying ? (
              <div className="relative flex-1 min-h-[560px] bg-gray-950 rounded-xl overflow-hidden border border-gray-800">
                <iframe
                  ref={iframeRef}
                  src={`/klecks/index.html?draftKey=${encodeURIComponent(draftKey)}`}
                  title="Klecks Drawing Editor"
                  className="w-full h-full min-h-[560px] border-0"
                  allow="clipboard-write"
                />

                {submittedDrawing && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
                    <div className="text-5xl mb-3">🎉</div>
                    <h3 className="text-xl font-bold text-emerald-400 mb-1">Drawing Submitted!</h3>
                    <p className="text-gray-400 text-sm max-w-sm">
                      Your drawing has been sent to the host. Sit tight while the round concludes!
                    </p>
                  </div>
                )}
              </div>
            ) : isResults ? (
              <div className="flex-1 min-h-[500px] bg-gray-950 rounded-xl border border-gray-800 flex flex-col items-center justify-center p-8 text-center">
                <div className="text-5xl mb-4">🏁</div>
                <h3 className="text-2xl font-bold text-yellow-400 mb-2">Round Concluded</h3>
                <p className="text-gray-400 text-sm max-w-md mb-6">
                  Check out the revealed answers and wait for the host to review drawings and award points!
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-[500px] bg-gray-950 rounded-xl border border-gray-800 flex flex-col items-center justify-center p-8 text-center">
                <div className="text-5xl mb-4">⏳</div>
                <h3 className="text-2xl font-bold text-indigo-400 mb-2">Lobby</h3>
                <p className="text-gray-400 text-sm max-w-md">
                  Waiting for the host to configure the secret characters and start the round...
                </p>
              </div>
            )}
          </div>

        </div>

      </main>
      )}
    </div>
  )
}
