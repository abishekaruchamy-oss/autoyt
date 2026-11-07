# Development Roadmap

## Phase 1: Dashboard Foundation & Account Management (Completed)
- [x] Next.js + TypeScript full-stack project structure
- [x] Responsive dark-theme dashboard with KPI metrics
- [x] Upload history table and mobile card view
- [x] Initial PostgreSQL schema & seed dataset
- [x] AES-256-GCM token encryption module
- [x] Automated test runner with 100% test pass

---

## Phase 1.1: Architecture Correction & Public Profile Monitoring (Completed)
- [x] **Step 1: Empirical Probe & POC**
  - Probed live Instagram public web behavior (`tests/poc-profile-monitor.ts`).
  - Proved that standard GET requests return a 508KB unrendered JS shell without SSR media.
  - Implemented honest status reporting rather than fabricating Reel data.
- [x] **Step 2: Core Data Model & D1 SQLite Schema**
  - Defined `MonitoredProfile`, `ProfileStatus`, `ProfileCheckResult`, `IMonitoringAdapter`.
  - Created `db/d1-schema.sql` tailored for Cloudflare D1 (SQLite).
- [x] **Step 3: Monitoring Adapter Architecture**
  - Built `StandardPublicWebAdapter`: standard permitted accessibility check with exact status reporting.
  - Built `PermittedSandboxAdapter`: authorized feed adapter for local and staging pipeline verification.
  - Implemented `ReelDeduplicationStore` with persistent tracking.
- [x] **Step 4: Backend API Refactor**
  - Created `/api/profiles` endpoints (GET, POST, PATCH, DELETE, check-now).
  - Updated `/api/dashboard` to surface monitored profiles metrics.
- [x] **Step 5: Frontend Public Profile Manager**
  - Refactored `/accounts` and `/profiles` into Public Profile Manager with clean URL input.
  - Individual profile cards with pause/resume toggles, check status pills, and last check timestamp.
  - Updated Dashboard active profile banner and overview stats.
- [x] **Step 6: YouTube & Google Drive Pipeline Integration**
  - Title formatting rule: First line of caption = YouTube title (with `#shorts`), full caption = description with source attribution.
  - YouTube upload status transition handling.
- [x] **Step 7: Cloudflare Deployment Configuration**
  - Wrote `wrangler.toml` for Cloudflare Workers/Pages + D1 binding + Cron scheduled checks.
- [x] **Step 8: End-to-End Testing & Verification**
  - Automated tests covering public profile lifecycle, deduplication, and title formatting.

---

## Phase 2: Real-World Integration & Cloud Deployment (Completed)
- [x] **Task 1: Architecture Audit**
  - Inspected repository for PostgreSQL, Docker, and n8n coupling; decoupled for serverless execution.
  - Verified Cloudflare Pages, Workers, D1 schema, and Cron trigger compatibility.
  - Added `/api/health` monitoring endpoint.
- [x] **Task 2: Google OAuth 2.0 Integration**
  - Implemented server-side OAuth flow (`src/server/services/googleAuthService.ts`) requesting `drive.file` and `youtube.upload` scopes.
  - Stored tokens encrypted with AES-256-GCM.
  - Implemented automated token refresh on expiration.
  - Created `/api/auth/google/authorize`, `callback`, and `disconnect` endpoints.
- [x] **Task 3: Google Drive Integration**
  - Implemented `GoogleDriveService` with automatic target folder creation (`Instagram Reels Backup`).
  - Implemented file existence check (Drive deduplication).
  - Implemented 5MB chunked resumable streaming upload protocol (`uploadStreamChunk`) without loading full video into RAM.
- [x] **Task 4: YouTube Data API v3 Shorts Publishing**
  - Implemented `YouTubeService` with channel detection and resumable video streaming upload.
  - Enforced YouTube shorts title extraction (first caption line capped at 85 chars + `#shorts`).
  - Preserved original caption as description with source attribution.
  - Implemented quota-aware error handling and established 5 uploads/day safety ceiling.
- [x] **Task 5: Pipeline Orchestrator & Settings Dashboard**
  - Built `PipelineService.runSync()` coordinating mutex locking, profile checking, deduplication, Drive archival, and YouTube publishing.
  - Updated `/api/automation/sync-now` and `/api/uploads/[id]/retry` to trigger real pipeline orchestration.
  - Rebuilt `src/components/settings/IntegrationsPanel.tsx` with Google connect/disconnect, folder setting, visibility selector, and live sync trigger.
- [x] **Task 6: Verification & Test Suite**
  - Expanded automated test suite to 12 tests (`npm test`): 100% OK.
  - Verified Next.js 16.4.5 production build (`npm run build`): 27 routes compiled cleanly with zero errors.

---

## Phase 3: Cloud Operations & Advanced Enhancements (Next Steps)
- [ ] Bind live Cloudflare D1 database via `npx wrangler d1 execute autoshorts-db --file=db/d1-schema.sql`.
- [ ] Provision Cloudflare Worker Secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`).
- [ ] Deploy frontend to Cloudflare Pages (`npx wrangler pages deploy .next`).
- [ ] Multi-channel destination routing (upload specific Instagram sources to separate YouTube channels).
- [ ] Webhook / Telegram / Discord notification triggers on upload completion.
