# 🚀 Zero-Cost Cloudflare Deployment Guide

This guide walks you through deploying **YoiKi** completely on **Cloudflare's Free Plan** ($0/month operating cost).

---

## 📋 Free-Tier Quota Compliance Checklist

- **Workers Inbound HTTP**: 100,000 requests / day (Only initial page loads and REST requests count).
- **Durable Objects (SQLite)**: 100,000 invocations / day, 13,000 GB-seconds compute / day (Uses WebSocket Hibernation API: 0 GB-seconds when idle).
- **Cloudflare D1**: 5,000,000 row reads / day, 100,000 row writes / day, 500 MB max database size.
- **Cloudflare R2**: 10 GB-months storage, 1,000,000 Class A writes / month, 10,000,000 Class B reads / month, **$0 egress fees**.
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

Open [`worker/wrangler.toml`](file:///f:/Yoiki/worker/wrangler.toml) and paste the returned `database_id` into line 10:
```toml
[[ d1_databases ]]
binding = "DB"
database_name = "yoiki-db"
database_id = "YOUR_ACTUAL_DATABASE_ID_HERE"
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

Apply the versioned schema to your production D1 instance:

```bash
npm run db:migrate:remote
```
*(Or directly: `cd worker && npx wrangler d1 migrations apply yoiki-db --remote`)*

You should see 16 commands executed successfully.

---

## Step 4: Deploy the Cloudflare Worker Backend

Deploy the Hono API and Durable Object to Cloudflare's edge:

```bash
npm --prefix worker run deploy
```

Upon completion, Wrangler will output your live Worker URL, for example:
```
https://yoiki-worker.<your-subdomain>.workers.dev
```

Test the remote health check in your browser:
```bash
curl https://yoiki-worker.<your-subdomain>.workers.dev/api/health
# Output: {"ok":true,"ts":1793633000000}
```

---

## Step 5: Deploy Frontend to Cloudflare Pages

### Option A: Using the Cloudflare Dashboard (Recommended)

1. Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Select repository: `Valcio13/YoiKi`.
3. Configure build settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `frontend`
4. Add Environment Variable:
   - Variable name: `VITE_API_URL`
   - Value: `https://yoiki-worker.<your-subdomain>.workers.dev`
5. Click **Save and Deploy**.

### Option B: Deploying via Wrangler CLI

From the repo root:

```bash
cd frontend
# Build the production bundle
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=yoiki
```

After deployment, in the Cloudflare Dashboard under **Pages** > **yoiki** > **Settings** > **Environment variables**, set:
- `VITE_API_URL = https://yoiki-worker.<your-subdomain>.workers.dev`
Trigger a redeployment to bake the variable into the client bundle.

---

## Step 6: Verify Deployment

1. Open your live Cloudflare Pages URL (e.g. `https://yoiki.pages.dev`).
2. Create a session in 2P mode with players "Alice" and "Bob".
3. Verify the Host Dashboard, Player Room, and OBS Spectator View load without console errors.
4. Test live drawing strokes and hint purchases.
