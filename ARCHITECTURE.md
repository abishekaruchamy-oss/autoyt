# System Architecture & Technical Specifications

## 1. High-Level Architecture

AutoShorts is designed for zero-maintenance, free-tier serverless cloud operations leveraging Cloudflare and Google Cloud APIs:

```
[Production Cloud Architecture]
 ┌──────────────────────────────────────────────────────────────┐
 │                     Cloudflare Pages                         │
 │           Next.js 16 + React 19 Web Dashboard               │
 └──────────────────────────────┬───────────────────────────────┘
                                │ REST API / Webhooks
 ┌──────────────────────────────▼───────────────────────────────┐
 │                     Cloudflare Workers                       │
 │      - Monitoring Adapter Engine                             │
 │      - Execution Mutex Concurrency Lock                      │
 │      - Pipeline Orchestrator (PipelineService)               │
 └──────────────┬───────────────────────────────┬───────────────┘
                │ SQLite Queries                │ Scheduled Polling
 ┌──────────────▼───────────────┐ ┌─────────────▼───────────────┐
 │        Cloudflare D1         │ │       Cloudflare Cron       │
 │   - monitored_profiles       │ │   (Executes every 30 mins)  │
 │   - reels & upload_jobs      │ └─────────────────────────────┘
 │   - integrations_config      │
 └──────────────┬───────────────┘
                │
                │ Authorized Original Media Pipeline (Zero-RAM Buffering)
 ┌──────────────▼───────────────┐ ┌─────────────────────────────┐
 │    Google Drive API (One)    │ │   YouTube Data API v3       │
 │  Original Video Archival     │ │   Auto Shorts Publishing    │
 │  - Resumable 5MB Chunks      │ │   - Resumable Video Stream  │
 │  - Deduplication Check       │ │   - First line -> Title     │
 │  - Auto-Folder Creation      │ │   - Daily Quota Ceiling (5) │
 └──────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Public Profile Monitoring Protocol (Phase 1.1)

### Permitted Public Information & Anti-Bypass Rules:
1. **Zero Access Bypass**: The application never uses credentials, session cookies, headless browser stealth evasion, or rotating proxy pools.
2. **Honest Status Reporting**:
   - When an unauthenticated request to an Instagram profile URL yields a login redirect or unhydrated client shell, the adapter registers `LOGIN_REQUIRED: Instagram requires authentication to view Reels for this profile. Anti-bot/login wall was not bypassed in compliance with policy.`
   - No fake or hallucinated Reels are ever created.
3. **Pluggable Adapter Interface (`IMonitoringAdapter`)**:
   ```typescript
   export interface IMonitoringAdapter {
     readonly name: string;
     checkProfile(profileUrl: string): Promise<ProfileCheckResult>;
     discoverReels(profile: MonitoredProfile, since?: string | null): Promise<ReelsDiscoveryResult>;
   }
   ```

---

## 3. Google OAuth 2.0 & Token Security Architecture (Phase 2 Task 2)

- **Combined Single Sign-On**: Authorizes Google Drive and YouTube under a single OAuth 2.0 authorization grant:
  - `https://www.googleapis.com/auth/drive.file` (Per-file access only; cannot access or delete unrelated user files)
  - `https://www.googleapis.com/auth/youtube.upload` (Upload videos as Shorts)
  - `https://www.googleapis.com/auth/youtube.readonly` (Inspect channel title, ID, thumbnail)
  - `https://www.googleapis.com/auth/userinfo.email`
- **Encryption at Rest**: All access and refresh tokens are encrypted using **AES-256-GCM** with unique 96-bit initialization vectors and authentication tags (`iv:tag:ciphertext`). Plaintext tokens are never written to disk, databases, or logs.
- **Automated Freshness Inspection**: `GoogleAuthService.getValidAccessToken()` inspects the expiration timestamp. If the token expires within 5 minutes, it transparently exchanges the refresh token with Google OAuth endpoints without interrupting active pipeline runs.

---

## 4. Google Drive Resumable Streaming Protocol (Phase 2 Task 3)

- **Zero Full-File RAM Buffering**: Video streams are consumed in 5MB (`5 * 1024 * 1024` bytes) binary chunks via HTTP range requests (`Content-Range: bytes START-END/TOTAL`).
- **Resumable Session Lifecycle**:
  1. `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable` with headers `X-Upload-Content-Type: video/mp4` and `X-Upload-Content-Length`.
  2. Receives unique `Location` session URI.
  3. Sequentially uploads 5MB chunks (`PUT`) expecting HTTP 308 (Resume Incomplete) until final chunk returns HTTP 200/201.
- **Interruption Recovery**: Can query `PUT` with `Content-Range: bytes */TOTAL` to discover last accepted byte offset and resume without restarting from byte 0.
- **Deduplication Check**: Searches destination folder (`GoogleDriveService.checkFileExists`) before initiating upload sessions to prevent duplicate storage costs.

---

## 5. YouTube Shorts Publishing & Quota Management (Phase 2 Task 4)

- **Resumable Upload Endpoint**: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`.
- **Title Derivation**:
  - Extracts the first non-empty line of the Instagram caption.
  - Limits length to 85 characters to guarantee space for the `#shorts` hashtag.
  - Automatically appends `#shorts` if not already present.
- **Description & Attribution**:
  - Retains the entire original caption text.
  - Appends source attribution: `Original source: Instagram @<username>\nPublished automatically via AutoShorts`.
- **API Quota Management**:
  - YouTube Data API v3 enforces a default project quota of **10,000 units/day**.
  - `videos.insert` consumes **1,600 units** per upload.
  - Maximum possible uploads on free tier: `10,000 / 1,600 = 6 uploads/day`.
  - AutoShorts configures a safe default ceiling of **`max_uploads_per_day = 5`** (~8,000 units), leaving 2,000 units for channel queries, status checks, and metadata operations.

---

## 6. End-to-End Pipeline State Machine (Phase 2 Task 5)

```
[Profile Check] ──────► [Reel Detected]
                              │
                              ▼
                      [Deduplication Check]
                              │
                    ┌─────────┴─────────┐
             (Duplicate)             (New)
                    │                   │
                 [Skip]                 ▼
                                  [DOWNLOADING]
                                        │
                                        ▼
                                  [STORED_DRIVE]
                                        │
                                        ▼
                              [UPLOADING_YOUTUBE]
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

- **Concurrency Mutex Lock**: Guaranteed via `acquireAutomationLock` / `releaseAutomationLock`. Only one pipeline runner can process jobs concurrently, preventing race conditions.

---

## 7. Cloudflare D1 (SQLite) Schema Reference

The database structure in `db/d1-schema.sql` consists of 6 tables:
1. `monitored_profiles`: Public profile URLs, status (`ACTIVE`, `PAUSED`, etc.), status reasons, and check timestamps.
2. `automation_settings`: Enabled state, active profile, polling interval, lock timestamp, upload ceilings, and Drive folder name.
3. `reels`: Unique Reel records with deduplication index on `reel_id`.
4. `upload_jobs`: Individual pipeline jobs linking Drive file IDs and YouTube video IDs.
5. `activity_logs`: Audit trail of all actions and errors.
6. `integrations_config`: Encrypted tokens and provider configuration.
