# Deployment Guide: Cloudflare Target Architecture

This guide covers deployment of AutoShorts to the **Cloudflare Ecosystem (Pages, Workers, D1, Cron)** without requiring paid cloud hosting or virtual machines.

---

## Architecture Topology

- **Frontend**: Cloudflare Pages (Next.js 16 + React 19)
- **Backend & APIs**: Next.js App Router / Cloudflare Workers
- **Database**: Cloudflare D1 (Serverless SQLite)
- **Scheduled Polling**: Cloudflare Cron Triggers (`*/30 * * * *` in `wrangler.toml`)
- **Storage**: Google Drive API (Google One Free or Paid Tier)
- **Publishing**: YouTube Data API v3 (Google Cloud Free Tier: 10,000 units/day)

---

## 1. Prerequisites

1. Cloudflare account (Free plan).
2. Google Cloud Console account with a project created.
3. Node.js 20+ and npm installed.
4. Cloudflare Wrangler CLI:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

---

## 2. Google Cloud Console Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable both required APIs:
   - **Google Drive API**
   - **YouTube Data API v3**
3. Configure the **OAuth Consent Screen**:
   - User Type: External
   - Add scopes:
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/youtube.upload`
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/userinfo.email`
   - Add your Google account as a Test User (or publish the app to Production).
4. Create Credentials:
   - Type: **OAuth 2.0 Client ID**
   - Application Type: **Web application**
   - Authorized Redirect URIs:
     - Local development: `http://localhost:3000/api/auth/google/callback`
     - Production: `https://<your-subdomain>.pages.dev/api/auth/google/callback`
5. Note your **Client ID** and **Client Secret**.

---

## 3. Cloudflare D1 Serverless Database Setup

1. Create the D1 database instance:
   ```bash
   npx wrangler d1 create autoshorts-db
   ```
2. Copy the returned `database_id` into `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "autoshorts-db"
   database_id = "<your-database-id-here>"
   ```
3. Apply the production schema:
   ```bash
   npx wrangler d1 execute autoshorts-db --file=./db/d1-schema.sql
   ```

---

## 4. Environment Variables & Secret Configuration

Configure production secrets in Cloudflare (or in `.env.local` for local development):

```bash
# Upload secrets to Cloudflare Workers / Pages
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

For `.env.local` (local development):
```ini
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> [!IMPORTANT]
> The `ENCRYPTION_KEY` must be a 64-character hex string (32 bytes). You can generate one with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 5. Local Development & Verification

1. Run all automated tests:
   ```bash
   npm test
   ```
   *Expected: All 12 test suites passing (100% OK).*

2. Run the production build test:
   ```bash
   npm run build
   ```
   *Expected: Clean compilation with 0 TypeScript and 0 lint errors.*

3. Start local development server:
   ```bash
   npm run dev
   ```
4. Verify health endpoint in your browser or curl:
   ```bash
   curl http://localhost:3000/api/health
   ```
   Returns: `{ "status": "healthy", "version": "2.0.0", "database": { "connected": true } }`.

---

## 6. Deploying to Cloudflare

1. Build the production application:
   ```bash
   npm run build
   ```
2. Deploy to Cloudflare Pages:
   ```bash
   npx wrangler pages deploy .next
   ```
3. Cloudflare Cron will automatically trigger polling every 30 minutes via the `*/30 * * * *` rule configured in `wrangler.toml`.
