# System Architecture & Technical Specifications

## 1. High-Level Architecture

AutoShorts is designed for zero-maintenance, free-tier serverless cloud operations leveraging Cloudflare Workers, Cloudflare D1, and Google Cloud APIs:

```
[Production Cloudflare & Google Cloud Architecture]
 ┌──────────────────────────────────────────────────────────────┐
 │                     Cloudflare Pages                         │
 │           Next.js 16 + React 19 Web Dashboard               │
 │           - Dashboard, Profile Manager, Automation           │
 │           - Primary Flow: Direct Reel URL Submission         │
 └──────────────────────────────┬───────────────────────────────┘
                                │ REST API / Webhooks
 ┌──────────────────────────────▼───────────────────────────────┐
 │             Cloudflare Worker (src/server/worker.ts)         │
 │      - Reel URL Extraction & MediaResolver Engine            │
 │      - Execution Mutex Concurrency Lock                      │
 │      - Pipeline Orchestrator (PipelineService)               │
 │      - D1 Database Client (env.DB)                           │
 └──────────────┬───────────────────────────────┬───────────────┘
                │ SQLite Queries                │ Scheduled Polling
 ┌──────────────▼───────────────┐ ┌─────────────▼───────────────┐
 │        Cloudflare D1         │ │       Cloudflare Cron       │
 │   - monitored_profiles       │ │   (Executes every 30 mins)  │
 │   - reels & upload_jobs      │ └─────────────────────────────┘
 │   - integrations_config      │
 └──────────────┬───────────────┘
                │
                │ Authorized Original Media Pipeline (Bounded In-Memory Streaming)
 ┌──────────────▼───────────────┐ ┌─────────────────────────────┐
 │    Google Drive API (One)    │ │   YouTube Data API v3       │
 │  Original Video Archival     │ │   Auto Shorts Publishing    │
 │  - Resumable 5MB Chunks      │ │   - Resumable Video Stream  │
 │  - Deduplication Check       │ │   - First line -> Title     │
 │  - Auto-Folder Creation      │ │   - Upload Bucket (~100/day)│
 └──────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Cloud-First Development & Minimum Local SSD Policy (Mandatory)

> [!CRITICAL]
> **Permanent Architectural Rule**: The developer/user's laptop SSD must **never** be used as project video storage or media processing storage. The goal is **near-zero laptop SSD consumption** across all workflows.

### 2.1 Core Invariants
1. **Zero Local Video Downloads**:
   - The application streams videos directly from authorized remote sources to Google Drive (`GoogleDriveService.streamVideoToDrive`) in memory chunks without ever writing a `.mp4` file to local disk.
   - Videos stream directly from Google Drive / remote URL to YouTube Shorts (`YouTubeService.streamVideoToYouTube`) via HTTP range streams in 5MB memory chunks.
   - Neither the web dashboard, background pipeline, nor automated test suites save `.mp4` or media files to the host machine.
   - All automated test fixtures generate synthetic in-memory streams (`createInMemoryTestVideo`), ensuring 0 bytes written to SSD.
2. **Zero Local Database Installations**:
   - Docker Desktop, local PostgreSQL server instances, and local container volumes are strictly banned from production runtime.
   - All persistent databases are hosted in **Cloudflare D1** (Serverless SQLite in the cloud).
   - In-memory state with zero disk persistence is used as local/test fallback.
3. **Remote Development & Execution**:
   - The canonical repository is hosted on **GitHub**.
   - Standardized Dev Container configuration (`.devcontainer/devcontainer.json`) and GitHub Actions workflow (`.github/workflows/remote-verify.yml`) enable cloud dependency installation, TypeScript checks, and test execution in GitHub Codespaces with zero local SSD wear.
4. **Proactive Cleanup**:
   - An automated cleanup tool (`npm run clean` -> `scripts/clean.js`) purges temporary build folders (`.next`, `out`, `.turbo`) safely.
   - *Note on Honest Reporting*: The policy targets near-zero project SSD usage; it does not claim literal absolute zero because operating systems and web browsers inherently maintain transient page caches and socket buffers.

---

## 3. Instagram Reel Submission Engine & Media Resolution (Phase 3)

### 3.1 Primary Workflow: Direct Reel URL Submission
Rather than attempting fragile unauthenticated web scraping, AutoShorts places direct creator Reel URL submission at the center of the platform (`/submit-reel`).

### 3.2 Shortcode Extraction Engine (`extractReelShortcode`)
- Parses canonical shortcodes (Base64url, 9-25 characters) across multiple URL formats:
  - Standard: `https://www.instagram.com/reel/C3b4XyzABC1/`
  - Reels Tab: `https://instagram.com/reels/C3b4XyzABC1/?igsh=...`
  - Post URL: `https://www.instagram.com/p/C3b4XyzABC1/`
  - Short URL: `https://instagr.am/reel/C3b4XyzABC1`
  - Bare shortcode: `C3b4XyzABC1`
- Normalizes all inputs to `https://www.instagram.com/reel/<shortcode>/`.

### 3.3 Provider-Independent Media Resolver (`MediaResolver`)
Decouples media resolution through a prioritized provider chain:
1. **UserDirectStreamProvider**: Connects user-provided direct video URLs or attached Google Drive video files.
2. **CreatorAuthorizedUrlProvider**: Resolves creator-authorized CDN streams.
3. **MetaGraphApiProvider**: Interfaces with official Meta Graph API when developer tokens are configured.
4. **StandardPublicProbeProvider**:
   - Strictly complies with anti-bypass rules (no stolen cookies, no CAPTCHA evasion, no scraping).
   - Probes public URL reachability and oEmbed metadata.
   - Honestly reports `WAITING_FOR_AUTHORIZED_MEDIA` when the raw MP4 binary is gated behind Instagram session authentication.
5. **SandboxTestProvider**: Safe test fixtures for local and CI automated verification.

### 3.4 Mandatory Copyright & Ownership Enforcement
The submission engine enforces mandatory user confirmation of video ownership or authorized creator republishing rights (`confirmedRights: true`) before any job is accepted into the pipeline.

---

## 4. Google OAuth 2.0 & Token Lifecycle Security

- **Scopes Requested**:
  - `https://www.googleapis.com/auth/drive.file` (Non-sensitive, per-file access)
  - `https://www.googleapis.com/auth/youtube.upload` (Sensitive, video upload)
  - `https://www.googleapis.com/auth/youtube.readonly` (Sensitive, channel inspection)
  - `https://www.googleapis.com/auth/userinfo.email`
- **Offline Access**: `access_type=offline` and `prompt=consent` guarantee issuance of a `refresh_token`.
- **7-Day Expiration Policy**: In Google Cloud "Testing" status with External users, refresh tokens expire in 7 days. Production deployment requires "In Production" publishing status with YouTube API verification or Google Workspace "Internal" user type.
- **AES-256-GCM Encryption**: Tokens are stored encrypted at rest (`iv:tag:ciphertext`). Plaintext tokens are never stored in databases or logs.
- **Token Freshness**: `getValidAccessToken()` automatically refreshes tokens 5 minutes before expiration.

---

## 5. Google Drive Resumable Streaming & Bounded Memory Profile

- **Chunked Transfer Protocol**: 5MB binary chunks (`uploadStreamChunk`) using HTTP range headers (`Content-Range: bytes START-END/TOTAL`) and HTTP 308 (Resume Incomplete).
- **Bounded Memory Profile (Empirical Measurement)**:
  - Total video size: **5,510,872 bytes** (5.51 MB)
  - Active streaming heap buffer delta: **~1.0 MB**
  - RSS: 57 MB baseline -> 99 MB active streaming
  - Zero whole-file RAM buffering: Only the active 5MB chunk is in memory at any given time. Zero bytes written to local SSD.
- **Interruption Recovery**: Can query `queryResumableStatus(sessionUri, totalBytes)` with `bytes */total` to retrieve `Range: bytes=0-<lastByte>` and resume without restarting.
- **Deduplication**: `checkFileExists` searches target folder before creating upload sessions.

---

## 6. YouTube Shorts Publishing & Upload Quota Bucket

- **Upload Quota Architecture**:
  - YouTube Data API v3 enforces a dedicated daily video upload bucket (default: **~100 uploads/day**), distinct from the general 10,000 project quota units.
  - AutoShorts enforces a configurable daily safety ceiling (default: **5 uploads/day**). This prevents channel spam flags and rate limits.
- **Title Derivation**: First non-empty caption line, trimmed to 85 characters max, appending `#shorts`.
- **Description & Attribution**: Entire caption preserved + `Original source: Instagram @<username>\nPublished automatically via AutoShorts`.
- **Visibility**: Supports `public`, `unlisted`, and `private` (default for testing).

---

## 7. Granular Pipeline State Machine

```
[Reel Submission / Discovery]
              │
              ▼
        [SUBMITTED]
              │
              ▼
        [VALIDATING] (Shortcode format & deduplication)
              │
              ▼
     [RESOLVING_MEDIA] (MediaResolver Provider Chain)
              │
     ┌────────┴──────────────────────────┐
     │ (Raw MP4 Gated)                   │ (Media Resolved)
     ▼                                   ▼
[WAITING_FOR_AUTHORIZED_MEDIA]    [MEDIA_AVAILABLE]
                                         │
                                         ▼
                                [ARCHIVING_TO_DRIVE] (5MB RAM chunk stream)
                                         │
                                         ▼
                                 [STORED_IN_DRIVE] (Drive file ID persisted)
                                         │
                                         ▼
                               [UPLOADING_TO_YOUTUBE] (Stream to Shorts)
                                         │
                                         ▼
                                 [VERIFYING_UPLOAD]
                                         │
                                ┌────────┴────────┐
                            (Success)          (Error)
                                │                 │
                                ▼                 ▼
                           [COMPLETED]         [FAILED]
                                                  │
                                                  ▼
                                             [RETRYING]
```

- **Concurrency Lock**: Guaranteed via `acquireAutomationLock` / `releaseAutomationLock`.
- **Scheduled Cron**: Cloudflare Cron (`triggers.crons = ["*/30 * * * *"]`) calls `scheduled()`, invoking `PipelineService.runSync()`.
