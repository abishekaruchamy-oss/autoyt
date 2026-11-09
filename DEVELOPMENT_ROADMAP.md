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
- [x] Empirical probe of unauthenticated Instagram web behavior
- [x] Data models and Cloudflare D1 (SQLite) schema (`db/d1-schema.sql`)
- [x] `StandardPublicWebAdapter` and `PermittedSandboxAdapter`
- [x] Reel deduplication store (`ReelDeduplicationStore`)
- [x] Full `/api/profiles` REST API endpoints
- [x] Public Profile Manager UI (`/accounts` and `/profiles`)
- [x] Title formatting rule (first caption line + `#shorts`)
- [x] Concurrency mutex lock (`acquireAutomationLock` / `releaseAutomationLock`)

---

## Phase 2: Real-World Integration & Cloud Deployment (Completed)
- [x] Architecture audit: decoupled PostgreSQL/Docker/n8n dependencies
- [x] Server-side Google OAuth 2.0 flow (`drive.file`, `youtube.upload`) with encrypted tokens
- [x] Google Drive resumable streaming upload service (5MB chunked protocol)
- [x] YouTube Data API v3 Shorts publishing service with private visibility default
- [x] Pipeline Orchestrator (`PipelineService.runSync`)
- [x] Settings & Integrations UI with Google connect/disconnect
- [x] Health check monitoring endpoint (`/api/health`)

---

## Phase 2.1: Production Readiness Audit & Minimum SSD Policy (Completed)
- [x] **Enforce Mandatory Minimum Local SSD Policy**
  - Purged all local video disk fixtures (`tests/fixtures/*.mp4`).
  - Switched tests to in-memory synthetic streams (`createInMemoryTestVideo`).
  - Added automated build artifact cleanup tool (`npm run clean` via `scripts/clean.js`).
  - Codified permanent zero-SSD requirements across architecture and deployment docs.
- [x] **Audit 1: Real Google OAuth & 7-Day Expiration Policy**
  - Verified authorization-code exchange, offline access, and consent prompt.
  - Documented Google Cloud "Testing" status 7-day refresh token expiration rule.
  - Outlined required actions for production (Google App Verification for sensitive scopes vs Google Workspace Internal user type).
- [x] **Audit 2: Real Video & Google Drive Streaming Memory Audit**
  - Verified in-memory 5.51 MB MP4 video streaming (MIME `video/mp4`, `ftyp` atom, `mp42` brand).
  - Measured memory profile: baseline heap 11.0 MB -> streaming heap 11.4 MB (peak delta ~1.0 MB). Proved bounded streaming without loading full video into RAM.
  - Tested interrupted upload recovery: queried status (`Range: bytes=0-5242879`) and resumed chunk 2 to completion.
  - Verified duplicate protection.
- [x] **Audit 3: YouTube Shorts Publishing & Quota Documentation Correction**
  - Verified title extraction (first caption line + `#shorts`) and description source attribution.
  - Implemented `queryResumableStatus` for YouTube resumable upload recovery.
  - Corrected quota documentation: documented dedicated ~100 uploads/day video upload bucket and clarified that the 5 uploads/day ceiling is a configurable pacing/anti-spam ceiling, not a mathematical derivative of 1,600 units.
- [x] **Audit 4: Cloudflare Production Compatibility**
  - Audited Next.js 16 + React 19 edge constraints.
  - Evaluated OpenNext vs `vinext` vs native Worker runtime.
  - Implemented `src/server/worker.ts` with `fetch()` router, D1 database binding, and `scheduled()` Cron execution handler.
  - Updated `wrangler.toml` with `nodejs_compat` flag and removed broken `.next` pages deploy shortcut.
- [x] **Audit 5: Instagram Monitoring Reality Check**
  - Executed live empirical probes demonstrating unauthenticated web requests return an empty React client shell (HTTP 200) without media or HTTP 404/checkpoint redirect on internal endpoints.
  - Confirmed that arbitrary public profile monitoring cannot retrieve video streams without bypassing access controls.
  - Documented 3 supported, permitted architectural alternatives.
- [x] **Audit 6: End-to-End Test Suite**
  - Created `tests/production-readiness-audit.ts`.
  - Added `npm run test:audit` and `npm run test:all`.
  - Verified 18/18 test suites passing (100% OK) and Next.js production build passing.

---

## Phase 3: Remote Development Migration & Reel URL Automation (Completed)
- [x] **Phase 3A – Remote Development Migration**
  - Dev Container configuration (`.devcontainer/devcontainer.json`) with Node.js 20 LTS, TypeScript, and port forwarding (3000 & 8787).
  - GitHub Actions remote verification CI/CD pipeline (`.github/workflows/remote-verify.yml`).
  - Zero-SSD storage invariant maintained with automated `npm run clean`.
- [x] **Phase 3B – Instagram Reel URL Submission Engine**
  - Direct Reel URL Dashboard page (`/submit-reel`) with navigation integration.
  - Reel shortcode extractor and normalizer (`extractReelShortcode`).
  - Provider-independent media resolution interface (`MediaResolver`):
    - `UserDirectStreamProvider`
    - `CreatorAuthorizedUrlProvider`
    - `UserDirectStreamProvider` (Google Drive source)
    - `StandardPublicProbeProvider` (honest waiting state reporting)
    - `SandboxTestProvider`
  - Granular pipeline state machine: `SUBMITTED` → `VALIDATING` → `RESOLVING_MEDIA` → `MEDIA_AVAILABLE` / `WAITING_FOR_AUTHORIZED_MEDIA` → `ARCHIVING_TO_DRIVE` → `STORED_IN_DRIVE` → `UPLOADING_TO_YOUTUBE` → `VERIFYING_UPLOAD` → `COMPLETED` / `FAILED`.
  - Reel deduplication engine preventing re-processing of previously seen shortcodes.
  - Mandatory creator copyright / ownership confirmation compliance check.
  - End-to-end zero-SSD streaming transfer pipeline to Google Drive and YouTube Shorts.
  - REST endpoints `/api/reels/submit` and `/api/reels` with Cloudflare Worker routing.
  - Comprehensive automated test suite (`tests/phase3-submission-engine.ts`) with 6/6 tests passing.
  - Verified 24/24 tests passing across all suites (`npm run test:all`).

---

## Phase 3.1: Live End-to-End Validation & SSD Audit (Completed)
- [x] **Remote Development & Antigravity Host Audit (Task 1)**:
  - Verified Antigravity operating locally on Windows host (`C:\Users\Abishek\OneDrive\Desktop\n8n`).
  - Audited local Git repository (`git remote -v` has no remote origin configured yet).
  - Dev Container (`.devcontainer/devcontainer.json`) and GitHub Actions (`.github/workflows/remote-verify.yml`) configured for remote execution.
- [x] **Real Media Retrieval Validation (Task 2)**:
  - Verified real direct video stream: `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4` (1,128,375 bytes, MIME `video/mp4`, atom `ftyp`, brand `mp42`, 0 disk bytes).
  - Verified real creator-authorized CDN stream: `big_buck_bunny.mp4` (5,510,872 bytes).
  - Verified unauthenticated Instagram web probe honesty (`WAITING_FOR_AUTHORIZED_MEDIA` without access bypass).
  - Added automated runner (`npm run test:media` via `tests/phase3-1-media-retrieval.ts`).
- [x] **SSD & Workspace Footprint Audit (Task 6)**:
  - Measured local repo: 473.02 MB total (471.81 MB `node_modules`, 0.36 MB `.git`, 0.00 MB build cache, 0.34 MB source).
  - Documented OneDrive background sync impact and confirmed dependencies/builds currently reside on local Windows SSD.
- [x] **Live Google Drive & YouTube Pipeline Validation Runner (Tasks 3, 4, 5)**:
  - Created `tests/phase3-1-live-pipeline.ts` (`npm run test:live`).
  - Validated credential detection: cleanly identifies missing `GOOGLE_CLIENT_ID` and prompts for user authorization.
  - Staged automated execution for real Drive folder creation, 5MB chunk streaming, duplicate check, and YouTube private upload.

---

## Live Experiment: Official Instagram Business Discovery (@zackdfilms) (Completed)
- [x] **Step 1: Codebase Inspection**: Reviewed `MediaResolver.ts`, D1 schema, and Cloudflare Worker Cron.
- [x] **Step 2: Meta Business Discovery Implementation**:
  - Implemented `InstagramBusinessDiscoveryService` and `InstagramBusinessDiscoveryAdapter` (`src/server/monitoring/businessDiscovery.ts`).
  - Added `InstagramBusinessDiscoveryProvider` to `MediaResolver.ts`.
  - Integrated with `PipelineService.runSync` for automated profile checking.
- [x] **Step 3: Actual Reel Retrieval Engine**:
  - Implemented `validateAndStreamMedia`: checks HTTP status, Content-Type, Content-Length, and validates MP4 box atoms (`ftyp`, `mp42`) with zero local SSD writes.
  - Strict fallback to `WAITING_FOR_AUTHORIZED_MEDIA` when media is gated.
- [x] **Step 4: Background Monitoring Registration**:
  - Registered `@zackdfilms` as active source in database.
  - Verified Cloudflare Worker Cron scheduled handler compatibility.
- [x] **Step 5 & 6: Automated Test Suite & Security**:
  - Created `tests/first-live-experiment-zackdfilms.ts` (`npm run test:experiment`).
  - Proved zero disk writes, 0.42 MB memory delta, and detailed Meta credential prerequisites without requesting plaintext secrets.

---

## Live Experiment: First Real Instagram Reel Retrieval Test (Reel: Dff42IfnIPz) (Completed)
- [x] **Step 1 & 2: Reel URL Validation & Normalization**:
  - Target URL: `https://www.instagram.com/reel/Dff42IfnIPz/`
  - Validated and extracted shortcode: `Dff42IfnIPz`
  - Canonical URL formatted: `https://www.instagram.com/reel/Dff42IfnIPz/`
- [x] **Step 3: Empirical Network Probes**:
  - Public HTTP HEAD probe returned HTTP 200 (`REEL_ACCESSIBLE`).
  - Public unauthenticated GET returned 511,807 characters of unhydrated React client shell (`mount_0_0_...`).
  - Confirmed: zero `<video>` tags, zero `og:video` tags, and zero direct `.mp4` URLs available unauthenticated.
- [x] **Step 4: Supported Public Metadata Retrieval**:
  - Query to Meta oEmbed endpoint returned HTTP 200 with `type: 'rich'`.
  - Confirmed oEmbed provides embeddable HTML snippets but explicitly does not expose raw MP4 video streams.
- [x] **Step 5: Authorized Meta API / Business Discovery Status**:
  - Checked environment configuration: Meta Graph API credentials not configured (`AUTHORIZATION_REQUIRED`).
- [x] **Step 6: Submission Engine Execution**:
  - Processed `https://www.instagram.com/reel/Dff42IfnIPz/` through `PipelineService.processSubmission` with rights confirmed.
  - Correctly transitioned: `SUBMITTED` -> `VALIDATING` -> `RESOLVING_MEDIA` -> `WAITING_FOR_AUTHORIZED_MEDIA`.
  - Enforced strict anti-bypass policy (no cookie extraction, no CAPTCHA bypass, no proxy evasion).
- [x] **Step 7 & 8: Real MP4 Container Structure & Bounded Streaming Validation**:
  - Validated container validator on real MP4 stream: 1,128,375 bytes, MIME `video/mp4`, atom `ftyp`, brand `mp42`.
  - Memory heap delta: 2.91 MB.
  - Local SSD bytes written: **0 bytes** (strict invariant satisfied).
- [x] **Step 9: Automated Verification Test**:
  - Created `tests/test-reel-dff42ifnipz.ts` and registered `npm run test:reel-retrieval`.
  - Verified 100% passing execution with exit code 0.

---

## Phase 4: Live Cloud Operations & Deployment Execution (Next Step)
- [ ] Connect live Google Cloud OAuth credentials in Cloudflare Secrets (`wrangler secret put`).
- [ ] Initialize live Cloudflare D1 database (`npx wrangler d1 execute autoshorts-db --file=db/d1-schema.sql`).
- [ ] Deploy worker to Cloudflare (`npx wrangler deploy`).
- [ ] Verify live scheduled checks with Cloudflare Cron.
