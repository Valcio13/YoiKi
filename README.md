# 🎨 Guess & Draw — Multiplayer Character Guessing Game

Guess & Draw is a private, real-time multiplayer character guessing game designed for live gaming sessions and OBS broadcast recording.

---

## 🎮 Game Concept & Rules

- **Modes**: 1 Host + 1 Player or 1 Host + 2 Players
- **2-Player Simultaneous Play**:
  - Player A holds the secret character that Player B must guess (Player A answers Player B's questions).
  - Player B holds the secret character that Player A must guess (Player B answers Player A's questions).
  - Both players ask verbal questions to each other and draw their guesses simultaneously in the integrated Klecks editor!
  - Both players can purchase text and image hints using their points.
- **1-Player Mode**:
  - The Host holds the secret character and answers the player's questions verbally while the player draws and buys hints.
- **Host Dashboard**:
  - Live dual-canvas stream previewing both players' drawings every 1.5 seconds via WebSocket.
  - Round progression controls (Lobby → Playing → Results → Next Round).
  - Secret character and hint management with image uploads.
  - Point awards (`+10`, `+25`, `+50 🏆 Winner`, `-10`, or custom delta with reason) and audit transaction history.
- **OBS Spectator Mode**:
  - Clean, fullscreen, high-contrast dark view displaying player names, points, round number, and live drawing canvases.
  - Zero spoilers: hides secrets and hints until revealed in Results phase.
  - No admin controls, no token exposure.

---

## 🏗️ Architecture & Technology Stack

```
f:\Yoiki\
├── frontend/               # Vite + React + TypeScript + Tailwind CSS
│   ├── public/
│   │   └── klecks/         # Bitbof Klecks drawing engine embed build
│   └── src/
│       ├── pages/
│       │   ├── HomePage.tsx      # Create session & share invite links
│       │   ├── HostDashboard.tsx # Host admin, character/hint manager & dual spectator
│       │   ├── PlayerRoom.tsx    # Split view: Held secret vs. Guess target & Klecks editor
│       │   └── SpectatorView.tsx # OBS broadcast layout
│       └── lib/
│           └── api.ts            # API & WebSocket client
├── worker/                 # Cloudflare Worker backend (Hono framework)
│   ├── src/
│   │   ├── index.ts        # Main router & WebSocket upgrade
│   │   ├── do/
│   │   │   └── GameRoom.ts # Cloudflare Durable Object for WebSocket relay
│   │   ├── routes/         # sessions, characters, hints, points, drawings, rounds
│   │   └── lib/            # auth (token verification) & db utilities
│   └── wrangler.toml
└── migrations/
    └── 0001_init.sql       # D1 SQLite relational schema
```

---

## 🚀 Running Locally

### 1. Prerequisites
- Node.js 18+
- npm 10+
- Wrangler CLI

### 2. Start the Backend Worker
```bash
cd worker
npm install
# Execute D1 database schema locally
npx wrangler d1 execute guess-draw-db --local --file=../migrations/0001_init.sql
# Run local worker dev server (port 8787)
npx wrangler dev --port 8787
```

### 3. Start the Frontend
In a separate terminal:
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🎨 Klecks Integration Highlights

- Compiled directly from the official [`bitbof/klecks`](https://github.com/bitbof/klecks) embed distribution.
- Hosted locally under `frontend/public/klecks/` with an iframe postMessage bridge.
- Auto-saves drafts every 10 seconds to `localStorage` per participant and round.
- Periodic snapshot streaming every 1.5 seconds over WebSocket to the Cloudflare Durable Object (`GameRoom`), routing canvas previews only to authorized host and spectator connections.
- Final submissions serialize to PNG and upload directly to R2 storage.

---

## 🔒 Security & Data Integrity

- **Role-based Authentication**: Cryptographically random 32-byte tokens for Host, Spectator, and each Player.
- **Strict Role Isolation**:
  - Players only receive the secret character they *hold*, never the one they are guessing.
  - Spectators receive zero character names or hint contents until the Host clicks "Reveal Answer" in the Results phase.
  - Hint text and hint images are completely hidden from API responses until purchased.
  - Hint purchases execute atomically via D1 batch operations with idempotency guarantees (cannot purchase twice, cannot purchase without sufficient balance).
