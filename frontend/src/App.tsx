import { useEffect, useState, lazy, Suspense } from 'react'
import HomePage from './pages/HomePage'
import { getRole, setToken, setRole, setSessionId } from './lib/api'

const HostDashboard = lazy(() => import('./pages/HostDashboard'))
const PlayerRoom = lazy(() => import('./pages/PlayerRoom'))
const SpectatorView = lazy(() => import('./pages/SpectatorView'))

function PageFallback() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
      <div className="flex items-center space-x-3">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">Loading YoiKi...</span>
      </div>
    </div>
  )
}

type View = 'home' | 'host' | 'player' | 'spectator'

function App() {
  const [view, setView] = useState<View>('home')

  useEffect(() => {
    // Check URL params for join links
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const role = params.get('role')
    const session = params.get('session')
    if (token && role) {
      setToken(token)
      setRole(role)
      if (session) {
        setSessionId(session)
      }
      setView(role as View)
    } else {
      const savedRole = getRole()
      if (savedRole && savedRole !== 'home') {
        setView(savedRole as View)
      }
    }
  }, [])

  const handleCreated = (role: View) => setView(role)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Suspense fallback={<PageFallback />}>
        {view === 'home' && <HomePage onNavigate={handleCreated} />}
        {view === 'host' && <HostDashboard />}
        {view === 'player' && <PlayerRoom />}
        {view === 'spectator' && <SpectatorView />}
      </Suspense>
    </div>
  )
}

export default App
