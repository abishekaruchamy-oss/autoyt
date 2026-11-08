# Deployment Guide: Cloudflare Target Architecture

This guide covers deployment of AutoShorts to **Cloudflare (Workers, D1, Cron)** and Google Cloud APIs.

---

## 1. Cloudflare Production Architecture

### Full-Stack Next.js Deployment Reality
> [!IMPORTANT]
> **Do not use `wrangler pages deploy .next` as a deployment shortcut.**
> Next.js App Router applications (`.next`) compile dynamic routes into Node.js server bundles (`.next/server`). Cloudflare Pages static hosting cannot execute Node.js server code without a serverless worker adapter.

AutoShorts provides two supported production deployment paths:

### Path A: Cloudflare Worker Runtime (`src/server/worker.ts`) – Recommended
The repository includes a native Cloudflare Worker entry point [src/server/worker.ts](file:///c:/Users/Abishek/OneDrive/Desktop/n8n/src/server/worker.ts):
- **API & OAuth Routes**: Handled via `fetch()` router with standard Web APIs and `nodejs_compat`.
- **Scheduled Automation**: Cloudflare Cron (`triggers.crons = ["*/30 * * * *"]`) calls `scheduled()`, executing `PipelineService.runSync()` inside `ctx.waitUntil()`.
- **D1 Database Binding**: Bound directly via `env.DB`.
- **Environment Secrets**: Injected into `env` at runtime (`wrangler secret put`).
- **Dashboard UI**: Static frontend pages exported to Cloudflare Pages or Cloudflare Workers Static Assets.

### Path B: OpenNext on Cloudflare Workers
OpenNext (`@opennextjs/cloudflare`) compiles Next.js App Router for Cloudflare Workers. Note that OpenNext currently officially targets Next.js 14.x and 15.x LTS. When deploying Next.js 16 (React 19), use Path A (native worker router) to guarantee stability.

---

## 2. Google Cloud OAuth & Consent Screen Setup

### 2.1 API Configuration
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Enable both required APIs:
   - **Google Drive API**
   - **YouTube Data API v3**

### 2.2 The 7-Day Refresh Token Rule & Publishing Status
> [!WARNING]
> In Google Cloud Console, if your OAuth Consent Screen has:
> - **User Type: External** AND
> - **Publishing Status: Testing**
> 
> Google **automatically expires all refresh tokens after 7 days** (168 hours). Background automations will fail after 7 days with `invalid_grant`.

To prevent 7-day token expiration:
- **Option 1 (For Organization / Workspace)**: Set **User Type: Internal**. Refresh tokens never expire, and Google App Verification is not required.
- **Option 2 (For Public / Personal Google Account)**: Move Publishing Status to **"In Production"**. Because `youtube.upload` and `youtube.readonly` are Sensitive Scopes, Google requires App Verification:
  1. Add domain verification in Google Search Console.
  2. Provide links to your Privacy Policy and Terms of Service.
  3. Submit a YouTube API Services compliance audit form with a short video demonstration showing how the application uses the requested scopes.

### 2.3 Create OAuth 2.0 Client Credentials
1. Under **Credentials**, create an **OAuth 2.0 Client ID** (Web application).
2. Authorized Redirect URIs:
   - Local: `http://localhost:3000/api/auth/google/callback`
   - Production: `https://<your-worker-or-pages-domain>/api/auth/google/callback`
3. Note `Client ID` and `Client Secret`.

---

## 3. YouTube Daily Upload Limits & Bucket Configuration

- YouTube Data API v3 maintains a **dedicated video upload limit bucket** (default documented limit is **approximately 100 video upload calls per day** per project/channel), separate from the general 10,000 daily project quota units.
- AutoShorts enforces a configurable daily safety ceiling (default: **`max_uploads_per_day: 5`**). This is an automation pacing throttle to protect newly created or connected creator channels from triggering YouTube's algorithmic spam review. It can be adjusted in Settings.

---

## 4. Cloudflare D1 Serverless Database Setup

1. Install Wrangler and authenticate:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. Create D1 database:
   ```bash
   npx wrangler d1 create autoshorts-db
   ```
3. Copy the generated `database_id` into `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "autoshorts-db"
   database_id = "<your-database-id>"
   ```
4. Execute the schema migration against D1:
   ```bash
   npx wrangler d1 execute autoshorts-db --file=./db/d1-schema.sql
   ```

---

## 5. Environment Secrets Configuration

Upload sensitive credentials to Cloudflare Workers using Wrangler:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

> [!NOTE]
> Generate a secure 32-byte (64 hex characters) encryption key:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 6. Deployment Commands

1. Run all test suites:
   ```bash
   npm run test:all
   ```
2. Deploy the serverless worker:
   ```bash
   npx wrangler deploy
   ```
3. Verify production health:
   ```bash
   curl https://<your-subdomain>.workers.dev/api/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "version": "2.1.0",
     "environment": "cloudflare-worker",
     "database": { "mode": "Cloudflare D1 (Bound)", "connected": true }
   }
   ```

---

## 7. Cloud-First Development & Minimum Local SSD Policy

> [!CRITICAL]
> **Permanent Architectural Rule**: The developer or user's laptop SSD must not be used as project video storage or media-processing storage. The goal is **near-zero laptop SSD consumption**.

### 7.1 Remote Development Workflow (Recommended)
1. **Host Canonical Code on GitHub**:
   - Push code to a remote GitHub repository.
2. **Standardized Dev Container & GitHub Codespaces**:
   - The repository includes `.devcontainer/devcontainer.json` preconfigured with Node.js 20 LTS, TypeScript, and port forwards for Next.js (`3000`) and Cloudflare Worker runtime (`8787`).
   - GitHub Actions (`.github/workflows/remote-verify.yml`) automatically executes remote verification (TypeScript checks, 24 test suites, and Next.js build) upon push.
   - Run dependency installation (`npm install`), compilation (`npm run build`), test execution (`npm test`), and deployment (`wrangler deploy`) directly in GitHub Codespaces.
   - The user's laptop is used strictly as a browser client, placing **zero build artifact or cache load on the local SSD**.

### 7.2 Local Development with Antigravity
When Antigravity runs locally:
- **Zero Local Media Files**: Do not download video files to the machine. Test suites run on in-memory synthetic streams (`createInMemoryTestVideo`).
- **Post-Development Purge**: After running builds or tests locally, run:
  ```bash
  npm run clean
  ```
  This immediately removes `.next`, `out`, and `.turbo` build folders from the disk.
- **OneDrive Sync Protection**: If your workspace resides inside a synced OneDrive folder, exclude `.next` and `node_modules` from sync to prevent background file locks (`EPERM`) and unnecessary cloud storage consumption.

