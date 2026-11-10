# Deployment Guide: Cloudflare Target Architecture

This guide covers the verified production deployment of **AutoShorts** to **Cloudflare (Workers, D1, Cron, Assets)**, **Remote Media Worker**, and **Google Cloud APIs**.

---

## 1. Unified Cloudflare Production Architecture

AutoShorts uses **Next.js 16.4.5** on Cloudflare Workers powered by **OpenNext Cloudflare adapter** (`@opennextjs/cloudflare` v1.20.16) and a unified entry point [`worker/index.ts`](file:///c:/Users/Abishek/OneDrive/Desktop/n8n/worker/index.ts):

```
                                  Cloudflare Global Edge
            ┌──────────────────────────────────────────────────────────────────┐
            │                     Cloudflare Worker Engine                     │
            │                         (worker/index.ts)                        │
            ├────────────────────────────────┬─────────────────────────────────┤
            │        HTTP Request Router     │     Cron Triggers (Scheduled)   │
            │      Delegates to OpenNext     │      "*/30 * * * *" (Every 30m) │
            │      (.open-next/worker.js)    │   PipelineService.runSync()     │
            ├───────────────┬────────────────┴─────────────────────────────────┤
            │ App Router UI │ API Routes (/api/*) & OAuth Handlers             │
            │ React 19 SSR  │ AES-256-GCM Token Encryption                     │
            │ Static Assets │ Mutex Concurrency Locks                          │
            └───────┬───────┴──────────────┬───────────────────────────┬───────┘
                    │                      │                           │
          Workers Static Assets      Cloudflare D1 SQL            Remote Worker
           (.open-next/assets)      (Serverless SQLite)         (yt-dlp microservice)
                    │                      │                           │
            Global CDN Cache       Monitored Profiles           Zero-SSD RAM
                                   Reels, Jobs, Logs            Stream Extractor
```

### Architectural Invariants Satisfied:
1. **Laptop-Off Autonomous Execution**: Cloudflare Cron Triggers execute independently on the edge every 30 minutes without requiring an active browser or laptop session.
2. **Near-Zero SSD Footprint**: All media streaming is executed in-memory or delegated to a remote media worker. No local MP4 files or persistent database files are stored on the host SSD.
3. **OpenNext Next.js 16 Runtime**: Full support for App Router pages (`/`, `/accounts`, `/automation`, `/profiles`, `/settings`, `/submit-reel`, `/uploads`), React Server Components, and Next.js Route Handlers.
4. **Unified Entry Point (`worker/index.ts`)**: Resolves the previous conflict where `wrangler.toml` bypassed Next.js pages. Both HTTP requests and Cron events are handled in a single unified Worker.

---

## 2. Cloudflare D1 Serverless Database Setup

> [!IMPORTANT]
> **Do not use placeholder D1 database IDs in version control.**
> Cloudflare requires a valid UUID generated for your account.

### Step 2.1: Authenticate Wrangler
```bash
npx wrangler login
```

### Step 2.2: Create the Production D1 Database
Execute the creation command:
```bash
npx wrangler d1 create autoshorts-db
```
Wrangler will output configuration similar to:
```toml
[[d1_databases]]
binding = "DB"
database_name = "autoshorts-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Step 2.3: Bind the D1 Database
Open [`wrangler.jsonc`](file:///c:/Users/Abishek/OneDrive/Desktop/n8n/wrangler.jsonc) (or [`wrangler.toml`](file:///c:/Users/Abishek/OneDrive/Desktop/n8n/wrangler.toml)) and insert the generated UUID:

In `wrangler.jsonc`:
```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "autoshorts-db",
      "database_id": "YOUR_ACTUAL_D1_UUID_HERE"
    }
  ],
```

### Step 2.4: Execute D1 Schema Migrations
Apply the production database tables, indexes, and initial constraints:
```bash
# Run schema migration against remote Cloudflare D1
npm run d1:migrate

# For local development testing (optional):
npm run d1:migrate:local
```

---

## 3. Environment Secrets Configuration

All sensitive keys are stored securely in Cloudflare's encrypted key-value store using `wrangler secret put`. **Never commit secrets to GitHub or version control.**

Run each command and paste the corresponding secret when prompted:

```bash
# 1. 256-bit (32-byte) Hex key for AES-256-GCM token encryption at rest
npx wrangler secret put TOKEN_ENCRYPTION_KEY

# 2. Google OAuth 2.0 Web Client ID
npx wrangler secret put GOOGLE_CLIENT_ID

# 3. Google OAuth 2.0 Client Secret
npx wrangler secret put GOOGLE_CLIENT_SECRET

# 4. (Optional) URL of the remote yt-dlp media extraction service
npx wrangler secret put RECLIP_SERVICE_URL
```

---

## 4. Google Cloud OAuth & Publishing Configuration

### 4.1 Required Google Cloud APIs
In [Google Cloud Console](https://console.cloud.google.com/):
1. Enable **Google Drive API**.
2. Enable **YouTube Data API v3**.

### 4.2 Authorized Redirect URIs
In **Credentials** > **OAuth 2.0 Client ID**:
- Local Development: `http://localhost:3000/api/auth/google/callback`
- Production Worker: `https://autoshorts.workers.dev/api/auth/google/callback` (or custom domain)

### 4.3 Resolving the 7-Day Refresh Token Expiration
> [!WARNING]
> If OAuth Consent Screen is **External** with Publishing Status **Testing**, Google expires refresh tokens after 7 days (168 hours).

- **For Google Workspace Users**: Choose **Internal** (refresh tokens never expire; verification not required).
- **For Personal Accounts**: Move Publishing Status to **In Production**. Complete YouTube API compliance verification for sensitive scopes (`youtube.upload`, `drive.file`).

---

## 5. Remote Media Worker Architecture (yt-dlp)

Because Cloudflare Workers runs in V8 `workerd` isolates without native OS process execution (`child_process`), yt-dlp runs via one of two supported architectures:

1. **Remote ReClip Microservice (Recommended for Laptop-Off Mode)**:
   Deploy a lightweight containerized microservice (e.g. on Railway, Render, or Fly.io free tier) running Python + yt-dlp. Configure `RECLIP_SERVICE_URL` in Cloudflare Secrets.
2. **Direct Submission Engine (Creator Self-Service)**:
   Submit authorized video URLs or Google Drive file IDs directly via `/submit-reel`. AutoShorts streams the media directly to Google Drive and YouTube without needing local yt-dlp.

---

## 6. Build, Verification & Deployment Commands

```bash
# 1. Verify TypeScript and Next.js production compilation
npm run build

# 2. Generate OpenNext Cloudflare Worker bundle (.open-next/worker.js & assets)
npm run build:worker

# 3. Dry-run deployment verification (tests configuration and asset bundling with 0 cost)
npm run deploy:dry-run

# 4. Live Cloudflare Production Deployment
npm run deploy

# 5. Clean up build cache to preserve near-zero host SSD usage
npm run clean
```
