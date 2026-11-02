# 🎨 YoiKi (与意気) — Private Real-Time Multiplayer Character Guessing Game

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers_%26_Durable_Objects-orange.svg)](https://workers.cloudflare.com/)
[![React 19](https://img.shields.io/badge/React-19.0-blue.svg)](https://react.dev/)
[![Zero Cost](https://img.shields.io/badge/Hosting_Cost-$0%2Fmonth-brightgreen.svg)](#-zero-cost-cloudflare-deployment)

**YoiKi** is a private, real-time multiplayer drawing and character guessing game designed specifically for game nights, livestreams, and OBS broadcast recording. Built entirely on **Cloudflare's serverless edge infrastructure**, it operates at **$0/month** on Cloudflare's free tier.

---

## 📸 Screenshots

| Host Dashboard | OBS Spectator View (1920×1080) |
| :---: | :---: |
| ![Host Dashboard](screenshot_host_dashboard.png) | ![OBS Spectator](screenshot_obs_spectator_1080p.png) |

| Player Room & Klecks Canvas | Final Results & Podium |
| :---: | :---: |
| ![Player Room](screenshot_player_a.png) | ![Final Results](screenshot_final_results.png) |

---

## 🎮 Game Concept & Rules

- **Simultaneous 2-Player Guess & Draw**:
  - **Player A** holds the secret character that **Player B** must guess, and answers Player B's verbal questions.
  - **Player B** holds the secret character that **Player A** must guess, and answers Player A's verbal questions.
  - Both players ask verbal questions to each other and draw their guesses simultaneously in the integrated **Klecks** canvas!
  - Both players can purchase text and image hints using their point balance.
- **1-Player Mode**:
  - The Host holds the character and answers the solo player's questions while the player draws.
- **Host Dashboard**:
  - Live side-by-side spectator preview updating every 2.5s via WebSockets.
  - Seamless fullscreen zoom modal with smooth zooming, player switching (`Tab` / `←` / `→`), and quick scoring buttons (`+10`, `+25`, `+50 🏆 Winner`, `-10`).
  - Secret character and hint management with reference image uploads.
- **OBS Spectator Mode**:
  - Clean, high-contrast, spoiler-free overlay (1920×1080) designed for OBS browser source capture.
- **End-Game Match Recap**:
  - Winner podium, player standings, hint audit totals, artwork gallery, and full transaction history ledger.

---

## 🏗️ Architecture & Technology Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4.
- **Drawing Engine**: Bitbof Klecks embedded build with sandboxed `postMessage` bridge.
- **Backend API**: Cloudflare Worker running [Hono](https://hono.dev/).
- **Relational Database**: Cloudflare D1 (SQLite) with versioned migrations.
- **WebSocket Relay**: Cloudflare SQLite Durable Object (`GameRoom`) with edge Hibernation API.
- **Object Storage**: Cloudflare R2 for final drawings and reference images ($0 egress fees).

For deep architecture diagrams and protocol details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 💰 Zero-Cost Cloudflare Deployment

YoiKi is intentionally engineered to stay well within Cloudflare’s Free Plan quotas:

| Service | Free Plan Limit | How YoiKi Uses It |
| :--- | :--- | :--- |
| **Workers HTTP** | 100,000 requests / day | REST API calls & initial WebSocket handshake only. |
| **Durable Objects** | 100,000 events / day, 13,000 GB-s | **WebSocket Hibernation API** suspends execution when idle (0 GB-s compute costs). |
| **Live Previews** | Transient in memory | 640×480 JPEG (0.5 quality) diffs streamed over WS; **never written to R2**. |
| **Cloudflare D1** | 5,000,000 read rows / day | Versioned relational migrations and point transaction ledger. |
| **Cloudflare R2** | 10 GB-months, 1M writes / month | Final completed drawings only (2 writes per round) with **$0 egress fees**. |
| **Cloudflare Pages** | Unlimited bandwidth | Zero-cost SPA hosting. |

For step-by-step setup instructions, see [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

---

## 🚀 Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- npm v10+

### 1. Clone & Install
```bash
git clone https://github.com/Valcio13/YoiKi.git
cd YoiKi
npm install
```

### 2. Apply Local Database Migrations
```bash
npm run db:migrate
```

### 3. Run Dev Server
Start both the Cloudflare Worker and Vite frontend concurrently:
```bash
npm run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Worker API**: [http://localhost:8787](http://localhost:8787)

---

## 🧪 Automated Visual Playtest

YoiKi includes an automated 3-browser end-to-end playtest using Playwright with Chromium/Edge:

```bash
node playtest.mjs
```

This verifies the complete gameplay flow from session creation, character secrecy isolation, simultaneous drawing, live dual-canvas spectator streaming, point deductions, drawing submission, and final winner podium calculations.

---

## 📚 Documentation Index

- [Architecture & Data Models](docs/ARCHITECTURE.md)
- [Zero-Cost Cloudflare Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [REST API & WebSocket Protocol Reference](docs/API_REFERENCE.md)

---

## 📄 License

MIT License. Bitbof Klecks is licensed under the Apache 2.0 License.
