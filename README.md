# AutoShorts: Multi-Account Instagram to YouTube Shorts Automation Platform

A production-ready full-stack automation platform that monitors multiple Instagram Creator accounts, archives published Reels to Google Drive (Google One storage), and automatically republishes them as YouTube Shorts using an n8n orchestration engine.

---

## Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │    Next.js + TypeScript Web Dashboard        │
                      │  (Mobile-First Responsive UI & Management)    │
                      └───────┬───────────────────────────────▲───────┘
                              │                               │
         Active Account Query │                               │ Status & Progress
            & Token Decrypt   │                               │ Reports
                              ▼                               │
                      ┌───────────────────────────────────────┴───────┐
                      │      Server-Side Node.js API Routes           │
                      │   - AES-256-GCM Token Encryption at Rest      │
                      │   - Concurrency Mutex Lock Engine             │
                      │   - Instagram OAuth Callbacks                 │
                      └───────┬───────────────────────────────▲───────┘
                              │                               │
                      ┌───────▼───────────────────────────────┴───────┐
                      │              PostgreSQL Database              │
                      │  - `instagram_accounts` (Multi-Account State) │
                      │  - `automation_settings` (Polling & Active ID)│
                      │  - `reels` & `upload_jobs` (Per-Account Log)  │
                      └───────────────────────▲───────────────────────┘
                                              │
               ┌──────────────────────────────┴──────────────────────────────┐
               │              n8n Automation Engine Worker                   │
               │   1. Fetches Dynamic Active Account via API                 │
               │   2. Acquires Concurrency Mutex Lock                        │
               │   3. Queries Meta Graph API (Reels detection)               │
               │   4. Downloads & Backups MP4 to Google Drive                │
               │   5. Uploads to YouTube Shorts with #shorts Tags            │
               │   6. Reports Status & Releases Lock                         │
               └─────────────────────────────────────────────────────────────┘
```

---

## Key Features Implemented

### 1. Unified Dashboard (`/`)
- **KPI Metrics Cards**: Total connected accounts, active accounts, total Reels detected, published YouTube Shorts, failed upload count, and Google Drive storage usage (used/total with visual progress gauge).
- **Active Source Card**: Displays the currently selected Instagram Creator account with 1-click account switching that updates the database dynamically.
- **Automation Quick Controls**: Master toggle (Active/Paused), polling interval badge, execution mutex lock status, and one-click manual synchronization trigger.
- **Recent Activity Feed**: Real-time chronological event stream (Reels detected, Google Drive transfers, YouTube Shorts published, token expiry alerts).

### 2. Multi-Account Instagram Manager (`/accounts`)
- **Official Meta OAuth Integration**: Server-side OAuth 2.0 flow with CSRF state token verification (`/api/auth/instagram/authorize` & `/api/auth/instagram/callback`).
- **Zero-Password Storage**: Passwords are never requested, handled, or stored. All access uses official Meta OAuth tokens encrypted with AES-256-GCM.
- **Instant Source Switching**: Switch the active source account in 1 click without altering n8n workflow definitions.
- **Token Expiration Detection**: Visual badges identifying tokens nearing expiry (< 7 days) or already expired, with a built-in renewal flow.
- **Demo / Creator Sandbox**: Easily test and demonstrate with simulated Creator accounts (`@techtrends_daily`, `@creativestudio_la`, `@fitnessfuel_pro`) or custom handles.

### 3. Automation Controls (`/automation`)
- **Master Engine Toggle**: Turn automated polling on/off with persistent database state.
- **Polling Frequency**: Configurable intervals (15 min, 30 min, 1 hour, 2 hours, 6 hours, 24 hours).
- **Execution Mutex Lock**: Built-in lock (`acquireAutomationLock` / `releaseAutomationLock`) preventing overlapping n8n runs.
- **Manual Sync Now**: Trigger immediate synchronization with real-time feedback.
- **n8n Webhook Architecture**: Interactive card documenting all endpoints (`/api/n8n/active-account`, `/api/n8n/lock`, `/api/n8n/unlock`, `/api/n8n/upload-status`) with copyable URLs.

### 4. Upload History & Queue (`/uploads`)
- **Comprehensive Lifecycle Tracking**: Tracks `DETECTED` → `DOWNLOADING` → `STORED_DRIVE` → `UPLOADING_YOUTUBE` → `COMPLETED` / `FAILED`.
- **Media Previews & Direct Links**: Reel thumbnail preview, clickable link to original Instagram Reel, Google Drive file link, and live YouTube Shorts link.
- **Error Inspector & Retry Action**: View failure details (e.g. API quota exhaustion) and trigger instant job retries.
- **Search & Filter Controls**: Search by caption, account handle, or reel ID, and filter by status and account.

### 5. Settings & Integrations (`/settings`)
- **Google Drive Storage**: Configure target backup folder name, view quota consumption (Google One).
- **YouTube Channel**: Configure default publishing visibility (`public`, `unlisted`, `private`) and channel metadata.
- **Meta App Credentials**: View App ID and client secret status.
- **System Demo Reset**: Reset all demo accounts, uploads, and logs back to the clean initial state anytime.

---

## Project Structure

```
├── db/
│   ├── schema.sql                      # Complete PostgreSQL 16 schema with tables & indexes
│   └── seed.sql                        # Production & demo seed data
├── docker-compose.yml                  # Postgres 16 + n8n + dashboard stack
├── Dockerfile                          # Multi-stage production container build
├── n8n/
│   ├── README.md                       # Guide for setting up n8n with the dashboard
│   └── workflows/
│       └── instagram_to_youtube_shorts.json # Importable production n8n workflow
├── src/
│   ├── app/
│   │   ├── accounts/page.tsx           # Instagram Account Manager UI
│   │   ├── automation/page.tsx         # Automation Controls & Schedule UI
│   │   ├── uploads/page.tsx            # Upload History & Pipeline Queue UI
│   │   ├── settings/page.tsx           # Settings & Integrations UI
│   │   ├── layout.tsx                  # Root responsive layout (Desktop sidebar + Mobile nav)
│   │   ├── page.tsx                    # Main Automation Dashboard Overview
│   │   └── api/
│   │       ├── accounts/               # Account CRUD & switching endpoints
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── activate/route.ts
│   │       │       ├── disconnect/route.ts
│   │       │       ├── reconnect/route.ts
│   │       │       └── route.ts
│   │       ├── automation/             # Automation config & manual sync
│   │       │   ├── route.ts
│   │       │   └── sync-now/route.ts
│   │       ├── uploads/                # Upload jobs & retry
│   │       │   ├── route.ts
│   │       │   └── [id]/retry/route.ts
│   │       ├── dashboard/route.ts      # Dashboard aggregate metrics
│   │       ├── settings/route.ts       # Integrations & folder config
│   │       ├── auth/instagram/         # Meta OAuth authorization & callback
│   │       │   ├── authorize/route.ts
│   │       │   └── callback/route.ts
│   │       ├── n8n/                    # n8n dynamic worker endpoints
│   │       │   ├── active-account/route.ts
│   │       │   ├── lock/route.ts
│   │       │   ├── unlock/route.ts
│   │       │   └── upload-status/route.ts
│   │       └── demo/reset/route.ts     # Demo state reset endpoint
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navigation.tsx          # Responsive Sidebar & Bottom Bar
│   │   │   └── TopHeader.tsx           # Header with active source pill & Sync Now
│   │   ├── dashboard/
│   │   │   ├── MetricsGrid.tsx         # KPI cards (accounts, reels, uploads, storage)
│   │   │   ├── ActiveSourceCard.tsx    # Active Instagram account card with switcher
│   │   │   ├── QuickControls.tsx       # Automation controls & manual sync
│   │   │   └── RecentActivityFeed.tsx  # Chronological activity timeline
│   │   ├── accounts/
│   │   │   ├── AccountCard.tsx         # Individual account card with status & actions
│   │   │   ├── AddAccountModal.tsx     # Connect account modal (Meta OAuth / Sandbox)
│   │   │   └── ReconnectModal.tsx      # Token refresh modal
│   │   ├── automation/
│   │   │   ├── AutomationSettingsForm.tsx # Polling interval, max uploads, visibility
│   │   │   └── WorkflowEndpointsCard.tsx  # Diagram & copyable URLs for n8n
│   │   ├── uploads/
│   │   │   └── UploadHistoryTable.tsx  # Responsive table + mobile card view
│   │   ├── settings/
│   │   │   └── IntegrationsPanel.tsx   # Storage & API integrations panel
│   │   └── ui/
│   │       └── Icons.tsx               # Scalable SVG branding icons
│   ├── lib/
│   │   ├── crypto.ts                   # AES-256-GCM token encryption & decryption
│   │   └── utils.ts                    # Time formatting, byte sizing, status badges
│   ├── server/
│   │   └── db/
│   │       ├── client.ts               # PostgreSQL connection pool with fallback
│   │       ├── mockData.ts             # Realistic initial seed data
│   │       └── repository.ts           # Unified repository (Postgres + In-Memory)
│   └── types/
│       └── index.ts                    # Full TypeScript data models
├── tests/
│   └── test-suite.ts                   # Automated unit & integration test suite
├── .env.example
├── .env.local
└── package.json
```

---

## Security Implementation

- **AES-256-GCM Token Encryption**: OAuth access tokens are encrypted before being written to storage using a 256-bit key with a 96-bit random initialization vector (`iv`) and authentication tag (`tag`). Format: `iv:tag:ciphertext`.
- **Token Masking & Stripping**: API responses to frontend clients strip the encrypted tokens entirely. Decryption occurs solely on server-to-server endpoints (such as `/api/n8n/active-account` protected by an optional bearer token).
- **Server-Side OAuth Callbacks**: OAuth code exchanges are performed exclusively on the server (`/api/auth/instagram/callback`) with CSRF `state` parameter validation.

---

## Running the Project

### Prerequisites
- Node.js 18+ (tested on Node.js v24.21.0)
- npm 9+ (tested on npm 11.19.0)
- Docker & Docker Compose (optional for PostgreSQL + n8n containers)

### 1. Development Mode (with Instant Demo Mode)
The dashboard includes an intelligent dual-mode database layer: if PostgreSQL is not currently running, it automatically operates in persistent demo mode with rich realistic creator accounts, reels, upload jobs, and activity logs.

```bash
# Clone or navigate to the project directory
cd "c:\Users\Abishek\OneDrive\Desktop\n8n"

# Install dependencies (already installed)
npm install

# Start the Next.js development server
npm run dev
```

Open your browser at: **`http://localhost:3000`**

### 2. Run Automated Tests
```bash
npm test
```
Runs the 5 test suites verifying:
1. AES-256-GCM token encryption, decryption, and masking.
2. Multi-account database model and instant active source switching.
3. Execution mutex lock concurrency protection.
4. Upload job history and retry execution.
5. Byte formatting and token expiry calculations.

### 3. Production Build
```bash
npm run build
npm start
```

### 4. Running with Docker Compose (PostgreSQL 16 + n8n + Dashboard)
When Docker Desktop is started:
```bash
docker compose up -d
```
- Dashboard: `http://localhost:3000`
- n8n Interface: `http://localhost:5678`
- PostgreSQL: `localhost:5432` (database: `autoshorts_db`)

---

## Remaining Setup Steps (Phase 2 & Production Credentials)

1. **Meta Developer App**:
   - Create an app on [developers.facebook.com](https://developers.facebook.com) with "Instagram Graph API" and "Facebook Login for Business".
   - Set the Redirect URI to `http://localhost:3000/api/auth/instagram/callback`.
   - Copy `App ID` and `App Secret` into `.env.local` (`META_CLIENT_ID` and `META_CLIENT_SECRET`).

2. **Google Cloud Console (Drive & YouTube)**:
   - Enable **Google Drive API** and **YouTube Data API v3** in Google Cloud Console.
   - Configure OAuth 2.0 Client Credentials.
   - Set up your Google One storage target folder ID.

3. **Import n8n Workflow**:
   - Open n8n at `http://localhost:5678`.
   - Import `n8n/workflows/instagram_to_youtube_shorts.json`.
   - Connect Google Drive and YouTube OAuth credentials.
   - Activate the schedule trigger.
