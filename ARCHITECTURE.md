# System Architecture & Technical Specifications

## 1. High-Level Architecture

AutoShorts is designed for cost-efficient, zero-maintenance cloud operations leveraging the Cloudflare free tier and Google cloud APIs:

```
[Target Cloudflare Architecture]
 ┌──────────────────────────────────────────────────────────────┐
 │                     Cloudflare Pages                         │
 │           Next.js / Static Export Web Dashboard              │
 └──────────────────────────────┬───────────────────────────────┘
                                │ REST API / RPC
 ┌──────────────────────────────▼───────────────────────────────┐
 │                     Cloudflare Workers                       │
 │      - Monitoring Adapter Engine                             │
 │      - Execution Mutex Lock                                  │
 │      - Upload Queue Dispatcher                               │
 └──────────────┬───────────────────────────────┬───────────────┘
                │ SQLite Queries                │ Scheduled Polling
 ┌──────────────▼───────────────┐ ┌─────────────▼───────────────┐
 │        Cloudflare D1         │ │       Cloudflare Cron       │
 │   - monitored_profiles       │ │   (Runs polling at interval)│
 │   - reels & upload_jobs      │ └─────────────────────────────┘
 │   - deduplication store      │
 └──────────────┬───────────────┘
                │
                │ Authorized Original Media Pipeline
 ┌──────────────▼───────────────┐ ┌─────────────────────────────┐
 │    Google Drive API (One)    │ │   YouTube Data API v3       │
 │  Original Video Archival     │ │   Auto Publishing (Shorts)  │
 └──────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Public Profile Monitoring Protocol

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
     discoverReels(profile: MonitoredProfile, since?: string): Promise<ReelsCheckResult>;
   }
   ```

---

## 3. Metadata & Publishing Standards

- **YouTube Title**: The first line of the original Instagram caption (trimmed to 100 characters max).
- **YouTube Description**: The complete, unaltered original Instagram caption, followed by source attribution.
- **Shorts Discovery**: Appends `#shorts` tag to the title if not already present.
- **Deduplication Key**: Composite key based on `instagram_reel_id` or canonical permalink hash.

---

## 4. Database Schema: Cloudflare D1 (SQLite)

Target D1 tables:
1. `monitored_profiles`: Profiles added by URLs with monitoring status (`ACTIVE`, `PAUSED`, `RESTRICTED`, `NOT_FOUND`), check timestamps, and status reasons.
2. `reels`: Discovered Reels with unique constraint on `reel_id` for deduplication.
3. `upload_jobs`: Tracks pipeline states (`DETECTED`, `DOWNLOADING`, `STORED_DRIVE`, `UPLOADING_YOUTUBE`, `COMPLETED`, `FAILED`, `RETRYING`).
4. `automation_settings`: Polling frequency, concurrency locks, and default publishing visibility.
5. `activity_logs`: Chronological audit log of all system actions.
