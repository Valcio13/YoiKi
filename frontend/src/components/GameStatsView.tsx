import { useState, useEffect } from 'react'
import { apiFetch, getToken, getApiImageUrl } from '../lib/api'

export interface GameStats {
  session: {
    id: string
    mode: string
    status: string
    current_round: number
    created_at: number
  }
  participants: Array<{
    id: string
    slot: number
    display_name: string
    points: number
    hints_purchased: number
    points_spent_on_hints: number
    drawings_submitted: number
    is_winner: boolean
  }>
  rounds: Array<{
    id: string
    round_number: number
    status: string
    characters: Array<{
      id: string
      name: string
      image_key?: string | null
      held_by_slot: number
      guessed_by_slot: number
    }>
    drawings: Array<{
      id: string
      participant_id: string
      display_name: string
      slot: number
      submitted: number
    }>
  }>
  transactions: Array<{
    id: string
    participant_id: string
    display_name: string
    delta: number
    reason: string
    created_at: number
  }>
}

interface Props {
  sessionId: string
  isHost?: boolean
  onClose?: () => void
  onRestart?: () => void
}

export default function GameStatsView({ sessionId, isHost, onClose, onRestart }: Props) {
  const token = getToken() || ''
  const [stats, setStats] = useState<GameStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await apiFetch<GameStats>(`/sessions/${sessionId}/stats`, {}, token)
        setStats(data)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [sessionId, token])

  async function handleRestart() {
    if (!confirm('Restart game session for a new match? Points will reset to 100.')) return
    setRestarting(true)
    try {
      await apiFetch(`/sessions/${sessionId}/restart`, { method: 'POST' }, token)
      if (onRestart) onRestart()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setRestarting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-gray-400">
        <div className="text-center">
          <div className="text-4xl animate-bounce mb-3">🏆</div>
          <p className="text-base font-semibold">Calculating Game Statistics...</p>
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="p-6 bg-red-950/80 border border-red-800 rounded-2xl text-center text-red-300">
        <p className="font-bold mb-1">Failed to load statistics</p>
        <p className="text-xs">{error}</p>
      </div>
    )
  }

  const winners = stats.participants.filter(p => p.is_winner)
  const isTie = winners.length > 1

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      
      {/* 1. VICTORY BANNER / PODIUM */}
      <div className="bg-gradient-to-b from-amber-950/60 via-gray-900 to-gray-950 border-2 border-amber-500/70 rounded-3xl p-8 text-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-32 bg-amber-500/10 blur-3xl pointer-events-none" />

        <div className="inline-block px-4 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-full text-xs font-black tracking-widest uppercase text-amber-300 mb-3">
          GAME OVER · FINAL RECAP
        </div>

        {isTie ? (
          <div>
            <div className="text-6xl mb-2">🤝</div>
            <h1 className="text-3xl md:text-5xl font-black text-white tracking-wide">
              It&apos;s a Tie!
            </h1>
            <p className="text-amber-300 text-lg font-bold mt-2">
              {winners.map(w => w.display_name).join(' and ')} tied with {winners[0]?.points} points!
            </p>
          </div>
        ) : winners.length === 1 ? (
          <div>
            <div className="text-6xl mb-2 animate-bounce">🏆</div>
            <h1 className="text-3xl md:text-5xl font-black text-amber-300 tracking-wide drop-shadow-md">
              {winners[0].display_name} Wins!
            </h1>
            <p className="text-gray-300 text-base font-medium mt-2">
              Champion with an astounding <strong className="text-yellow-400 font-bold">{winners[0].points} points</strong>!
            </p>
          </div>
        ) : (
          <div>
            <div className="text-6xl mb-2">🏁</div>
            <h1 className="text-3xl md:text-4xl font-black text-white">Game Concluded</h1>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500">
          Session ID: <span className="font-mono text-gray-400">{stats.session.id}</span> · Completed {stats.rounds.length} Round{stats.rounds.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* 2. LEADERBOARD & DETAILED PLAYER STATS */}
      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-xl">
        <h2 className="text-xl font-black text-white mb-4 flex items-center gap-2">
          <span>📊</span> Final Player Standings
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.participants.map((p, idx) => (
            <div
              key={p.id}
              className={`rounded-2xl p-5 border relative overflow-hidden flex flex-col justify-between ${
                p.is_winner
                  ? 'bg-gradient-to-br from-amber-950/40 to-gray-900 border-amber-500/70 shadow-lg'
                  : 'bg-gray-950 border-gray-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-xs ${
                      idx === 0 ? 'bg-amber-400 text-black' : 'bg-gray-800 text-gray-300'
                    }`}>
                      #{idx + 1}
                    </span>
                    <h3 className="font-black text-lg text-white">{p.display_name}</h3>
                  </div>

                  <div className="text-right">
                    <span className="text-2xl font-black text-yellow-400 font-mono tracking-tight">
                      {p.points}
                    </span>
                    <span className="text-xs text-gray-500 font-bold uppercase ml-1">PTS</span>
                  </div>
                </div>

                {/* Stat pills */}
                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                  <div className="bg-gray-900/90 rounded-xl p-2.5 border border-gray-800">
                    <span className="text-xs text-gray-400 block font-medium">Hints Bought</span>
                    <span className="text-base font-bold text-indigo-300">{p.hints_purchased}</span>
                  </div>
                  <div className="bg-gray-900/90 rounded-xl p-2.5 border border-gray-800">
                    <span className="text-xs text-gray-400 block font-medium">Pts on Hints</span>
                    <span className="text-base font-bold text-amber-400">{p.points_spent_on_hints}</span>
                  </div>
                  <div className="bg-gray-900/90 rounded-xl p-2.5 border border-gray-800">
                    <span className="text-xs text-gray-400 block font-medium">Drawings</span>
                    <span className="text-base font-bold text-emerald-400">{p.drawings_submitted}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. ROUND-BY-ROUND GALLERY: TARGET VS. DRAWING */}
      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <span>🎨</span> Round-by-Round Artwork &amp; Answers
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Compare the secret target character with what each player actually drew!
            </p>
          </div>
        </div>

        {stats.rounds.length === 0 ? (
          <p className="text-gray-500 text-sm italic text-center py-6">No rounds were completed.</p>
        ) : (
          <div className="space-y-6">
            {stats.rounds.map((round) => (
              <div key={round.id} className="bg-gray-950 border border-gray-850 rounded-2xl p-5">
                <div className="flex items-center justify-between border-b border-gray-800 pb-3 mb-4">
                  <span className="font-black text-base text-indigo-300">
                    Round {round.round_number}
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    Status: <strong className="text-gray-400 uppercase">{round.status}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {stats.participants.map((p) => {
                    // Character this player was GUESSING
                    const targetChar = round.characters.find(c => c.guessed_by_slot === p.slot)
                    // Drawing this player submitted
                    const playerDrawing = round.drawings.find(d => d.participant_id === p.id)

                    return (
                      <div key={p.id} className="bg-gray-900/90 border border-gray-800 rounded-xl p-4 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-sm text-white">{p.display_name}&apos;s Guess</span>
                            <span className="text-xs font-semibold text-gray-400">Slot {p.slot}</span>
                          </div>

                          <div className="bg-gray-950 rounded-lg p-2.5 mb-3 border border-gray-800 text-center">
                            <span className="text-xs text-gray-500 uppercase tracking-widest block">Secret Target</span>
                            <span className="text-lg font-black text-yellow-300">
                              {targetChar?.name || 'Unknown'}
                            </span>
                          </div>

                          {/* Drawing Display */}
                          <div className="aspect-4/3 bg-black rounded-lg overflow-hidden border border-gray-800 flex items-center justify-center">
                            {playerDrawing ? (
                              <img
                                src={getApiImageUrl(`/drawings/image/${playerDrawing.id}`, token)}
                                alt={`${p.display_name} drawing`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="text-center text-gray-600 text-xs">
                                <span>🖌️</span>
                                <p className="mt-1">No drawing submitted</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. POINT TRANSACTION LOG */}
      <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black text-white flex items-center gap-2">
            <span>📜</span> Point Audit Trail
          </h2>
          <button
            onClick={() => setShowHistory(prev => !prev)}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
          >
            {showHistory ? 'Hide Details ▲' : 'Show Details ▼'}
          </button>
        </div>

        {showHistory && (
          <div className="space-y-1.5 mt-3 max-h-60 overflow-y-auto pr-1">
            {stats.transactions.map((tx) => (
              <div key={tx.id} className="bg-gray-950 px-3.5 py-2 rounded-xl text-xs flex items-center justify-between border border-gray-850">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-200">{tx.display_name}</span>
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

      {/* 5. ACTION BUTTONS (Host controls & Return) */}
      <div className="flex items-center justify-center gap-4 flex-wrap pt-4">
        {isHost && (
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-2xl shadow-xl transition flex items-center gap-2"
          >
            <span>🔄</span> {restarting ? 'Restarting...' : 'Play Again (Reset Points)'}
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-2xl transition"
          >
            Back to Dashboard
          </button>
        )}
      </div>

    </div>
  )
}
