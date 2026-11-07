# Deployment Guide: Cloudflare Target Architecture

This guide covers deployment of AutoShorts to the **Cloudflare Ecosystem (Pages, Workers, D1, Cron)** without requiring paid cloud hosting.

---

## Architecture Topology

- **Frontend**: Cloudflare Pages (Next.js export or Pages Full-Stack Next.js adapter)
- **Backend**: Cloudflare Workers / Pages Functions
- **Database**: Cloudflare D1 (Serverless SQLite)
- **Scheduled Polling**: Cloudflare Cron Triggers (`wrangler.toml`)
- **Storage**: Google Drive API (Google One Free / Paid Tier)
- **Publishing**: YouTube Data API v3 (Google Cloud Free Tier: 10,000 units/day)

---

## 1. Prerequisites

1. Cloudflare account (Free plan)
2. Cloudflare Wrangler CLI installed:
   ```bash
   npm install -g wrangler
   ```
3. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

---

## 2. Cloudflare D1 Database Setup

Create the D1 database:
```bash
wrangler d1 create autoshorts-db
```
This outputs your database name and ID. Update `wrangler.toml` with the generated `database_id`.

Execute the schema against D1:
```bash
wrangler d1 execute autoshorts-db --file=./db/d1-schema.sql
```

---

## 3. Cloudflare Cron Trigger (Scheduled Polling)

In `wrangler.toml`:
```toml
name = "autoshorts"
main = "src/server/worker.ts"
compatibility_date = "2024-04-01"

[[d1_databases]]
binding = "DB"
database_name = "autoshorts-db"
database_id = "your-database-id-here"

[triggers]
crons = ["*/30 * * * *"] # Executes every 30 minutes
```

---

## 4. Google Drive & YouTube Credentials Configuration

Store your server-side secrets in Cloudflare Workers environment:
```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put YOUTUBE_CLIENT_ID
wrangler secret put YOUTUBE_CLIENT_SECRET
```
*Note: Never commit these secrets to Git or expose them in client-side code.*
