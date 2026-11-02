import { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import HostDashboard from './pages/HostDashboard'
import PlayerRoom from './pages/PlayerRoom'
import SpectatorView from './pages/SpectatorView'
import { getRole, setToken, setRole, setSessionId } from './lib/api'

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
      {view === 'home' && <HomePage onNavigate={handleCreated} />}
      {view === 'host' && <HostDashboard />}
      {view === 'player' && <PlayerRoom />}
      {view === 'spectator' && <SpectatorView />}
    </div>
  )
}

export default App
