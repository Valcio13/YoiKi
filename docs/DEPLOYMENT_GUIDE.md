# 🚀 Zero-Cost Cloudflare Deployment Guide

This guide walks you through deploying **YoiKi** completely on **Cloudflare's Free Plan** ($0/month operating cost).

---

## 📋 Free-Tier Quota Compliance Checklist

- **Workers Inbound HTTP**: 100,000 requests / day (Only initial page loads and REST requests count).
- **Durable Objects (SQLite)**: 100,000 invocations / day, 13,000 GB-seconds compute / day (Uses WebSocket Hibernation API: 0 GB-seconds when idle).
- **Cloudflare D1**: 5,000,000 row reads / day, 100,000 row writes / day, 500 MB max database size.
- **Cloudflare R2**: 10 GB-months storage, 1,000,000 Class A writes / month, 10,000,000 Class B reads / month, **$0 egress fees**. *(Note: Cloudflare requires a card on file in Account Billing to enable R2 for verification, but zero charges occur within this free quota).*
- **Cloudflare Pages**: Unlimited bandwidth, 500 builds / month.

---

## 🛠️ Prerequisites

1. A free [Cloudflare Account](https://dash.cloudflare.com/sign-up).
2. [Node.js](https://nodejs.org/) v18+ and `npm`.
3. Wrangler CLI logged into your Cloudflare account:
   ```bash
   npx wrangler login
   ```

---

## Step 1: Provision Cloudflare D1 Database

Run from the root of the repository:

```bash
npx wrangler d1 create yoiki-db
```

Output will display your database binding configuration:
```toml
[[d1_databases]]
binding = "DB"
database_name = "yoiki-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Open [`worker/wrangler.toml`](file:///f:/Yoiki/worker/wrangler.toml) and replace `database_id = "local-db"` on line 10 with your returned production UUID:
```toml
[[ d1_databases ]]
binding = "DB"
database_name = "yoiki-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

## Step 2: Provision Cloudflare R2 Storage Bucket

Create the R2 bucket for storing completed drawing artworks:

```bash
npx wrangler r2 bucket create yoiki-storage
```

*(This matches the bucket binding `STORAGE` defined in [`worker/wrangler.toml`](file:///f:/Yoiki/worker/wrangler.toml)).*

---

## Step 3: Apply Remote D1 Database Migrations

Apply the versioned schema to your remote production D1 instance:

```bash
npm run db:migrate:remote
```
*(Or directly from `worker/`: `cd worker && npx wrangler d1 migrations apply yoiki-db --remote`)*

You should see 16 commands executed successfully.

---

## Step 4: Configure Environment & Deploy Worker Backend

### 1. Verify Production Variables in `worker/wrangler.toml`

Before deploying, ensure `[vars]` in [`worker/wrangler.toml`](file:///f:/Yoiki/worker/wrangler.toml) reflects your production origin:
```toml
[vars]
ENVIRONMENT = "production"
# Set to your intended Cloudflare Pages domain (e.g. https://yoiki.pages.dev) and local dev:
ALLOWED_ORIGINS = "https://yoiki.pages.dev,http://localhost:5173"
```

### 2. Deploy Worker Backend

From the repository root:
```bash
npm --prefix worker run deploy
```
*(Or from `worker/`: `cd worker && npm run deploy`)*

Upon completion, Wrangler will output your live Worker URL, for example:
```
https://yoiki-worker.<your-subdomain>.workers.dev
```

Test the remote health check:
```bash
curl https://yoiki-worker.<your-subdomain>.workers.dev/api/health
# Output: {"ok":true,"ts":1793633000000}
```

---

## Step 5: Configure & Deploy Frontend to Cloudflare Pages

> **CRITICAL**: Vite bakes `VITE_API_URL` into JavaScript assets **at build time**. You must provide `VITE_API_URL` **before** executing `npm run build`.

### Option A: Using the Cloudflare Dashboard (Recommended)

1. In Cloudflare Dashboard, go to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Select your repository: `Valcio13/YoiKi`.
3. Configure build settings:
   - **Framework preset**: `Vite`
   - **Root directory**: `frontend`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. **Environment variables (set before saving)**:
   - Add variable: `VITE_API_URL`
   - Value: `https://yoiki-worker.<your-subdomain>.workers.dev` (from Step 4)
5. Click **Save and Deploy**. Cloudflare will run the build with the variable injected.

### Option B: Deploying via Wrangler CLI

If deploying directly from your machine:

1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Create `frontend/.env.production` containing your deployed Worker URL:
   ```bash
   # In PowerShell:
   Set-Content -Path .env.production -Value "VITE_API_URL=https://yoiki-worker.<your-subdomain>.workers.dev"
   
   # Or in Bash:
   echo "VITE_API_URL=https://yoiki-worker.<your-subdomain>.workers.dev" > .env.production
   ```
3. Build the production client bundle:
   ```bash
   npm run build
   ```
4. Deploy the bundle to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy dist --project-name=yoiki
   ```

---

## Step 6: Verify Production CORS & Live Game

1. Check that the deployed Pages URL matches the `ALLOWED_ORIGINS` in [`worker/wrangler.toml`](file:///f:/Yoiki/worker/wrangler.toml). If you chose a different project name (e.g. `https://my-custom-app.pages.dev`), update `ALLOWED_ORIGINS` in `worker/wrangler.toml` and re-run `npm --prefix worker run deploy`.
2. Open your live Cloudflare Pages URL in your browser.
3. Create a 2P session with participants "Alice" and "Bob".
4. Open the Host Dashboard and the two player rooms in separate browser windows.
5. Draw on the Klecks canvas and confirm live stroke previews update on the spectator screen.
6. Purchase a hint and verify point deduction and hint text visibility.
7. Submit drawings and verify session stats recap podium.
