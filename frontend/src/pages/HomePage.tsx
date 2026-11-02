import { useState } from 'react'
import { apiFetch, setToken, setRole, setSessionId } from '../lib/api'

interface Props {
  onNavigate: (role: 'host' | 'player' | 'spectator') => void
}

interface CreateResponse {
  sessionId: string
  hostToken: string
  spectatorToken: string
  mode: string
  participants: Array<{ id: string; slot: number; name: string; joinToken: string }>
}

export default function HomePage({ onNavigate }: Props) {
  const [mode, setMode] = useState<'1p' | '2p'>('2p')
  const [player1Name, setPlayer1Name] = useState('')
  const [player2Name, setPlayer2Name] = useState('')
  const [startPoints, setStartPoints] = useState(100)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdSession, setCreatedSession] = useState<CreateResponse | null>(null)

  async function createSession() {
    if (!player1Name.trim()) { setError('Enter player 1 name'); return }
    if (mode === '2p' && !player2Name.trim()) { setError('Enter player 2 name'); return }
    setLoading(true)
    setError('')
    try {
      const playerNames = mode === '2p'
        ? [player1Name.trim(), player2Name.trim()]
        : [player1Name.trim()]
      const data = await apiFetch<CreateResponse>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ mode, playerNames, startingPoints: startPoints }),
      })
      setCreatedSession(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function enterAsHost() {
    if (!createdSession) return
    setToken(createdSession.hostToken)
    setRole('host')
    setSessionId(createdSession.sessionId)
    onNavigate('host')
  }

  const origin = window.location.origin

  if (createdSession) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-2 text-indigo-400">🎨 Yoiki</h1>
        <p className="text-gray-400 mb-8">Session created! Share the links below.</p>

        <div className="bg-gray-900 rounded-xl p-6 mb-4">
          <h2 className="font-semibold text-lg mb-4">Session Links</h2>

          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1">HOST LINK (keep private)</p>
            <div className="flex gap-2">
              <code className="flex-1 bg-gray-800 text-indigo-300 px-3 py-2 rounded text-sm truncate">
                {origin}?token={createdSession.hostToken}&role=host&session={createdSession.sessionId}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(`${origin}?token=${createdSession.hostToken}&role=host&session=${createdSession.sessionId}`)}
                className="px-3 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600"
              >Copy</button>
            </div>
          </div>

          {createdSession.participants.map((p) => (
            <div key={p.id} className="mb-4">
              <p className="text-xs text-gray-500 mb-1">{p.name.toUpperCase()} PLAYER LINK</p>
              <div className="flex gap-2">
                <code className="flex-1 bg-gray-800 text-green-300 px-3 py-2 rounded text-sm truncate">
                  {origin}?token={p.joinToken}&role=player&session={createdSession.sessionId}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(`${origin}?token=${p.joinToken}&role=player&session=${createdSession.sessionId}`)}
                  className="px-3 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600"
                >Copy</button>
              </div>
            </div>
          ))}

          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1">SPECTATOR LINK (OBS safe)</p>
            <div className="flex gap-2">
              <code className="flex-1 bg-gray-800 text-yellow-300 px-3 py-2 rounded text-sm truncate">
                {origin}?token={createdSession.spectatorToken}&role=spectator&session={createdSession.sessionId}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(`${origin}?token=${createdSession.spectatorToken}&role=spectator&session=${createdSession.sessionId}`)}
                className="px-3 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600"
              >Copy</button>
            </div>
          </div>
        </div>

        <button
          onClick={enterAsHost}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-lg transition"
        >
          Enter Host Dashboard →
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-8 pt-20">
      <h1 className="text-4xl font-bold mb-2 text-indigo-400">🎨 Yoiki</h1>
      <p className="text-gray-400 mb-10">Private multiplayer character guessing game</p>

      <div className="bg-gray-900 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Game Mode</label>
          <div className="flex gap-3">
            {(['1p', '2p'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg font-medium transition ${
                  mode === m ? 'bg-indigo-600' : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >
                {m === '1p' ? '1 Player' : '2 Players'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Player 1 Name</label>
          <input
            value={player1Name}
            onChange={(e) => setPlayer1Name(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            placeholder="e.g. Alice"
          />
        </div>

        {mode === '2p' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Player 2 Name</label>
            <input
              value={player2Name}
              onChange={(e) => setPlayer2Name(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
              placeholder="e.g. Bob"
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">Starting Points</label>
          <input
            type="number"
            value={startPoints}
            onChange={(e) => setStartPoints(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            min="0"
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={createSession}
          disabled={loading}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl font-semibold text-lg transition"
        >
          {loading ? 'Creating...' : 'Create Game Session'}
        </button>
      </div>
    </div>
  )
}
