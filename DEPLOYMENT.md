# ShiftSync — Zero-Cost Deployment Guide

**Total cost: $0/month**

| Service | Provider | What it hosts |
|---------|----------|---------------|
| Frontend (React SPA) | Vercel (free) | Static build, global CDN |
| Backend (Express API + BullMQ) | Render (free) | Node.js web service |
| PostgreSQL | Neon (free) | Serverless Postgres, always-on |
| Redis | Upstash (free) | Serverless Redis, Socket.io adapter |
| CI/CD | GitHub Actions (free) | Typecheck + build gate on every PR |

> **Free-tier caveat:** Render's free web service **sleeps after 15 minutes of inactivity**. The first request after sleep takes 30–60 seconds. The Neon and Upstash free tiers have no cold-start penalty.

---

## Prerequisites

- GitHub account (repo must be public, or Vercel/Render connected to private)
- Node.js 20+ installed locally for any local steps

---

## Step 1 — PostgreSQL with Neon

1. Go to [neon.tech](https://neon.tech) → **Sign Up** (free, no credit card)
2. Click **New Project** → name it `shiftsync`
3. Choose region closest to your users (US East or EU Central)
4. Once created, go to **Dashboard → Connection string**
5. Copy the **postgres://...** connection string — it looks like:
   ```
   postgresql://shiftsync_owner:<password>@ep-xxxx.us-east-2.aws.neon.tech/shiftsync?sslmode=require
   ```
6. Save this as `DATABASE_URL` — you'll need it in Steps 3 and 4

---

## Step 2 — Redis with Upstash

1. Go to [upstash.com](https://upstash.com) → **Sign Up** (free)
2. Click **Create Database**
3. Name: `shiftsync-redis`, Region: same as Neon, Type: **Regional**
4. On the database page, click the **Redis** tab → copy the connection string:
   ```
   redis://default:<password>@<host>.upstash.io:6379
   ```
   Or for TLS (recommended):
   ```
   rediss://default:<password>@<host>.upstash.io:6379
   ```
5. Save this as `REDIS_URL`

---

## Step 3 — Backend on Render

### Option A: Deploy via render.yaml (recommended)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) → **Sign Up** → connect GitHub
3. Click **New → Blueprint**
4. Select your repository
5. Render will detect `render.yaml` at the root
6. Click **Apply**
7. The service `shiftsync-api` will be created
8. Go to the service → **Environment** → add the secrets that are marked `sync: false`:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon connection string from Step 1 |
| `REDIS_URL` | Your Upstash connection string from Step 2 |
| `FRONTEND_URL` | Your Vercel URL (set this after Step 4, e.g. `https://shiftsync.vercel.app`) |

9. Click **Manual Deploy → Deploy latest commit**
10. Watch the deploy logs — Prisma migrations run automatically on startup

### Option B: Deploy manually via Render dashboard

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Name:** `shiftsync-api`
   - **Runtime:** Node
   - **Region:** Oregon (or Frankfurt)
   - **Plan:** Free
   - **Build Command:**
     ```
     corepack enable && pnpm install --frozen-lockfile && pnpm --filter @shiftsync/shared build && pnpm --filter @shiftsync/backend build && cd packages/backend && npx prisma generate
     ```
   - **Start Command:**
     ```
     cd packages/backend && npx prisma migrate deploy && node dist/server.js
     ```
   - **Health Check Path:** `/healthz`
4. Add environment variables (same table as Option A above, plus):

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `JWT_ACCESS_SECRET` | Generate: `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Generate: `openssl rand -hex 32` |
| `CSRF_SECRET` | Generate: `openssl rand -hex 32` |
| `ACCESS_TOKEN_TTL` | `900` |
| `REFRESH_TOKEN_TTL` | `604800` |

5. Click **Create Web Service**

### Get your backend URL

After deploy, your API is live at:
```
https://shiftsync-api.onrender.com
```
(Render uses the service name; adjust if you named it differently)

---

## Step 4 — Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign Up** → connect GitHub
2. Click **Add New → Project** → select your repository
3. Configure the import:
   - **Framework Preset:** Vite (Vercel auto-detects this)
   - **Root Directory:** `packages/frontend`
   - Leave build/output settings as auto-detected (`vercel.json` handles them)
4. **Environment Variables** — add one variable:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://shiftsync-api.onrender.com/api/v1` |

5. Click **Deploy**
6. Once deployed, copy your Vercel URL (e.g., `https://shiftsync-abc.vercel.app`)

### Update CORS on Render

Go back to Render → `shiftsync-api` service → **Environment** → update:

| Key | Value |
|-----|-------|
| `FRONTEND_URL` | `https://shiftsync-abc.vercel.app` (your actual Vercel URL) |

Then trigger a redeploy on Render.

---

## Step 5 — Run the Seed (optional but recommended)

The seed populates all 9 test accounts, skills, locations, shifts, and assignments.

From your local machine, with the production `DATABASE_URL`:

```bash
# Set your Neon DATABASE_URL
export DATABASE_URL="postgresql://..."

cd packages/backend
npx prisma migrate deploy
SEED_ADMIN_PASSWORD="YourSecureAdminPass!" npx tsx prisma/seed.ts
```

Or use Neon's SQL editor to run the seed SQL manually if you prefer.

---

## Step 6 — GitHub Actions CI (automatic)

The `.github/workflows/ci.yml` file is already in the repo. It runs on every push and PR:
- Typechecks all packages
- Builds shared, backend, and frontend
- On successful push to `main`, optionally triggers a Render deploy

### Enable auto-deploy from GitHub Actions

1. In Render: go to your service → **Settings → Deploy Hook** → copy the URL
2. In GitHub: go to your repo → **Settings → Secrets and variables → Actions**
3. Add a new secret: `RENDER_DEPLOY_HOOK_URL` = the Render deploy hook URL
4. Now every push to `main` that passes CI will auto-deploy to Render

> **Note:** Vercel auto-deploys on every push to `main` automatically once connected — no extra setup needed.

---

## Step 7 — Verify the deployment

```bash
# Health check
curl https://shiftsync-api.onrender.com/healthz
# → {"status":"ok"}

# Readiness check (tests DB + Redis connectivity)
curl https://shiftsync-api.onrender.com/readyz
# → {"status":"ready"}

# Test login
curl -X POST https://shiftsync-api.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@shiftsync.local","password":"ChangeMe123!"}'
# → {"accessToken":"...","csrfToken":"...","user":{...}}
```

Then open your Vercel URL in a browser and log in.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Repository                       │
│                                                             │
│   Push to main ──→ GitHub Actions CI ──→ Render Deploy Hook │
│                                     └──→ Vercel (auto)      │
└─────────────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌────────────────┐         ┌─────────────────────┐
│   Vercel CDN   │         │   Render Free Tier  │
│                │         │                     │
│  React SPA     │ ──API──▶│  Express + BullMQ   │
│  (static)      │◀──WS───▶│  Socket.io          │
└────────────────┘         └─────────────────────┘
                                    │         │
                          ┌─────────┘         └──────────┐
                          ▼                              ▼
                 ┌─────────────────┐         ┌──────────────────┐
                 │   Neon (free)   │         │  Upstash (free)  │
                 │                 │         │                  │
                 │  PostgreSQL     │         │  Redis           │
                 │  Serverless     │         │  (BullMQ queues  │
                 │  Always-on      │         │  + Socket.io     │
                 └─────────────────┘         │   adapter)       │
                                             └──────────────────┘
```

---

## Environment Variables Reference

### Backend (Render)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `REDIS_URL` | ✅ | Upstash Redis connection string |
| `JWT_ACCESS_SECRET` | ✅ | Random 32+ byte hex string |
| `JWT_REFRESH_SECRET` | ✅ | Random 32+ byte hex string (different from access) |
| `CSRF_SECRET` | ✅ | Random 32+ byte hex string |
| `FRONTEND_URL` | ✅ | Your Vercel app URL (no trailing slash) |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ✅ | `4000` |
| `ACCESS_TOKEN_TTL` | Optional | Seconds; default `900` (15 min) |
| `REFRESH_TOKEN_TTL` | Optional | Seconds; default `604800` (7 days) |
| `DEV_FRONTEND_URLS` | Optional | Comma-separated extra allowed origins |

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | Full backend API base URL, e.g. `https://shiftsync-api.onrender.com/api/v1` |

---

## Troubleshooting

**Backend cold start is slow (30–60 s)**  
Normal on Render's free tier. The service sleeps after 15 min of inactivity. The frontend shows a loading state while waiting.

**`/readyz` returns `not_ready`**  
Check that `DATABASE_URL` and `REDIS_URL` are correctly set in Render's environment. Also verify Neon allows connections from Render's IP range (Neon's free tier allows all IPs by default).

**CORS error in browser console**  
`FRONTEND_URL` on Render doesn't match the actual Vercel domain. Update it and redeploy. Make sure there's no trailing slash.

**Socket.io not connecting**  
Upstash Redis requires TLS — make sure your `REDIS_URL` starts with `rediss://` (double-s). Also confirm Render's free tier allows WebSocket upgrades (it does).

**Prisma migration fails on startup**  
Check `DATABASE_URL` is valid and includes `?sslmode=require` for Neon. Verify the database user has `CREATE TABLE` permissions.

**Seed fails with "already exists" error**  
The seed uses `skipDuplicates: true` and `upsert`, so it's idempotent — safe to run multiple times. If you see a different error, check the DB is reachable.
