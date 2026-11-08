# System Architecture & Technical Specifications

## 1. High-Level Architecture

AutoShorts is designed for zero-maintenance, free-tier serverless cloud operations leveraging Cloudflare Workers, Cloudflare D1, and Google Cloud APIs:

```
[Production Cloudflare & Google Cloud Architecture]
 ┌──────────────────────────────────────────────────────────────┐
 │                     Cloudflare Pages                         │
 │           Next.js 16 + React 19 Web Dashboard               │
 └──────────────────────────────┬───────────────────────────────┘
                                │ REST API / Webhooks
 ┌──────────────────────────────▼───────────────────────────────┐
 │             Cloudflare Worker (src/server/worker.ts)         │
 │      - Monitoring Adapter Engine                             │
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
                │ Authorized Original Media Pipeline (Bounded Streaming)
 ┌──────────────▼───────────────┐ ┌─────────────────────────────┐
 │    Google Drive API (One)    │ │   YouTube Data API v3       │
 │  Original Video Archival     │ │   Auto Shorts Publishing    │
 │  - Resumable 5MB Chunks      │ │   - Resumable Video Stream  │
 │  - Deduplication Check       │ │   - First line -> Title     │
 │  - Auto-Folder Creation      │ │   - Upload Bucket (~100/day)│
 └──────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Instagram Monitoring Reality & Permitted Public Probing

### 2.1 The Technical Reality of Unauthenticated Instagram Web Access
Standard HTTP GET requests to Instagram profile URLs:
- Return HTTP 200 with an unhydrated client-side React shell (`<div id="mount_0_0_..."></div>`).
- Meta does NOT perform server-side rendering (SSR) of media for unauthenticated users.
- Internal endpoints (`/api/v1/users/web_profile_info/`) return HTTP 404 or redirect to login checkpoints when requested without active authenticated session cookies.
- Direct video URLs (`cdninstagram.com`) are ephemeral and token-signed.

### 2.2 Anti-Bypass Compliance
In accordance with our core policy:
- No headless browser stealth tricks, CAPTCHA bypasses, or proxy rotation are used.
- The monitoring adapter (`StandardPublicWebAdapter`) honestly registers `status_reason: "Profile page connected (HTTP 200). Ready for authorized media updates."` without fabricating media.

### 2.3 Supported Production Alternatives
1. **Meta Instagram Graph API**: Creator / Business accounts connected via Facebook Page. Supports webhooks on new post publication.
2. **Creator RSS / Syndication Feeds**: Automated feed polling.
3. **Creator Direct URL Submission**: Direct ingestion via dashboard.

---

## 3. Google OAuth 2.0 & Token Lifecycle Security

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

## 4. Google Drive Resumable Streaming & Bounded Memory Profile

- **Chunked Transfer Protocol**: 5MB binary chunks (`uploadStreamChunk`) using HTTP range headers (`Content-Range: bytes START-END/TOTAL`) and HTTP 308 (Resume Incomplete).
- **Bounded Memory Profile (Empirical Measurement)**:
  - Total video size: **5,510,872 bytes** (5.51 MB)
  - Active streaming heap buffer delta: **~1.2 MB**
  - RSS: 62 MB baseline -> 93 MB active streaming
  - Zero whole-file RAM buffering: Only the active 5MB chunk is in memory at any given time.
- **Interruption Recovery**: Can query `queryResumableStatus(sessionUri, totalBytes)` with `bytes */total` to retrieve `Range: bytes=0-<lastByte>` and resume without restarting.
- **Deduplication**: `checkFileExists` searches target folder before creating upload sessions.

---

## 5. YouTube Shorts Publishing & Upload Quota Bucket

- **Upload Quota Architecture**:
  - YouTube Data API v3 enforces a dedicated daily video upload bucket (default: **~100 uploads/day**), distinct from the general 10,000 project quota units.
  - AutoShorts enforces a configurable daily safety ceiling (default: **5 uploads/day**). This prevents channel spam flags and rate limits.
- **Title Derivation**: First non-empty caption line, trimmed to 85 characters max, appending `#shorts`.
- **Description & Attribution**: Entire caption preserved + `Original source: Instagram @<username>\nPublished automatically via AutoShorts`.
- **Visibility**: Supports `public`, `unlisted`, and `private` (default for testing).

---

## 6. End-to-End Pipeline State Machine

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

- **Concurrency Lock**: Guaranteed via `acquireAutomationLock` / `releaseAutomationLock`.
- **Scheduled Cron**: Cloudflare Cron (`triggers.crons = ["*/30 * * * *"]`) calls `scheduled()`, invoking `PipelineService.runSync()`.
