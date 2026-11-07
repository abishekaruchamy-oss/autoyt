# Development Roadmap

## Phase 1: Dashboard Foundation & Account Management (Completed)
- [x] Next.js + TypeScript full-stack project structure
- [x] Responsive dark-theme dashboard with KPI metrics
- [x] Upload history table and mobile card view
- [x] Initial PostgreSQL schema & seed dataset
- [x] AES-256-GCM token encryption module
- [x] Automated test runner with 100% test pass

---

## Phase 1.1: Architecture Correction & Public Profile Monitoring (Current)
- [x] **Step 1: Empirical Probe & POC**
  - Probed live Instagram public web behavior (`tests/poc-profile-monitor.ts`).
  - Proved that standard GET requests return a 508KB unrendered JS shell without SSR media.
  - Implemented honest status reporting rather than fabricating Reel data.
- [ ] **Step 2: Core Data Model & D1 SQLite Schema**
  - Define `MonitoredProfile`, `ProfileStatus`, `ProfileCheckResult`, `IMonitoringAdapter`.
  - Write `db/d1-schema.sql` tailored for Cloudflare D1 (SQLite).
- [ ] **Step 3: Monitoring Adapter Architecture**
  - Build `StandardPublicWebAdapter`: standard permitted accessibility check with exact status reporting.
  - Build `PermittedSandboxAdapter`: authorized feed adapter for local and staging pipeline verification.
  - Implement `ReelDeduplicationService` with persistent tracking.
- [ ] **Step 4: Backend API Refactor**
  - Create `/api/profiles` endpoints:
    - `GET /api/profiles`: List all monitored profiles
    - `POST /api/profiles`: Add a new profile URL
    - `PATCH /api/profiles/[id]`: Pause, resume, or edit profile URL
    - `DELETE /api/profiles/[id]`: Remove profile
    - `POST /api/profiles/[id]/check`: Manual trigger check
  - Update `/api/dashboard` to surface monitored profiles metrics.
- [ ] **Step 5: Frontend Public Profile Manager**
  - Refactor `/accounts` into Public Profile Manager with clean URL input.
  - Individual profile cards with pause/resume toggles, check status pills, and last check timestamp.
  - Update Dashboard active profile banner and overview stats.
- [ ] **Step 6: YouTube & Google Drive Pipeline Integration**
  - Title formatting rule: First line of caption = YouTube title, full caption = description.
  - YouTube upload status transition handling.
- [ ] **Step 7: Cloudflare Deployment Configuration**
  - Write `wrangler.toml` for Cloudflare Workers/Pages + D1 binding + Cron scheduled checks.
- [ ] **Step 8: End-to-End Testing & Verification**
  - Update `tests/test-suite.ts` to cover public profile lifecycle, deduplication, and title formatting.
  - Run production build and verify zero regressions.

---

## Phase 2: Cloud Production Deployment & Live Publishing
- [ ] Google Cloud Console OAuth setup (Drive & YouTube Data API v3).
- [ ] Cloudflare D1 database initialization (`wrangler d1 execute`).
- [ ] Cloudflare Cron worker deployment for automated polling.
- [ ] Production end-to-end video transfer and YouTube publishing verification.
