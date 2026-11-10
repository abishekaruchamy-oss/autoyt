# Architecture & Engineering Decisions (ADR Log)

## ADR-001: Separation of Cloud Target from Local Stack
- **Context**: The Phase 1 foundation used Docker, local PostgreSQL, and an n8n container.
- **Decision**: Target production hosting on Cloudflare (Pages, Workers, D1, Cron) to achieve a zero-cost, serverless deployment without maintaining persistent VM servers or paid databases.
- **Consequences**: Data layer uses an abstract repository compatible with both local SQLite/PostgreSQL development and Cloudflare D1 production.

## ADR-002: Removal of Instagram OAuth in Favor of Public URL Monitoring
- **Context**: Meta's Instagram Graph API requires complex Business verification, App Review, Facebook Page linkage, and user tokens that expire every 60 days.
- **Decision**: Switch entirely to unauthenticated Public Profile URL Monitoring (`https://instagram.com/example/`).
- **Consequences**: No user OAuth friction, zero token expiration problems, and zero credential storage risks.

## ADR-003: Strict Compliance with Platform Policies & Anti-Scraping Rules
- **Context**: Instagram aggressively gates unauthenticated web requests behind client-side JavaScript shells and login checkpoints.
- **Decision**: In strict accordance with the product mandate, we will NOT use proxy rotation, headless browser evasion, or CAPTCHA bypasses.
- **Consequences**: The system accurately reports the true accessibility status of the profile (`ACCESSIBLE`, `LOGIN_REQUIRED`, or `NOT_FOUND`). When unauthenticated access is restricted by Instagram, the exact reason is logged and presented on the dashboard.

## ADR-004: First Line Title Rule for YouTube Shorts
- **Context**: Instagram Reels only have a single `caption` field, whereas YouTube Shorts require a distinct `title` and `description`.
- **Decision**: Extract the first line of the caption as the YouTube title (capped at 85 characters + `#shorts`) and retain the full caption text as the YouTube description with original source attribution.
- **Consequences**: Maximizes organic CTR on YouTube Shorts while preserving the creator's full copy, links, and hashtags in the description.

## ADR-005: Cloudflare D1 Compatibility
- **Context**: Cloudflare D1 uses SQLite, which differs from PostgreSQL in types (no native UUID or TIMESTAMPTZ).
- **Decision**: Store timestamps as ISO 8601 text (`YYYY-MM-DDTHH:MM:SS.sssZ`) and booleans as integer 0/1, maintaining full SQL compatibility with D1.

## ADR-006: Server-Side Unified Google OAuth 2.0 with AES-256-GCM Encrypted Storage
- **Context**: AutoShorts requires authorization for both Google Drive (to archive original MP4 files) and YouTube Data API v3 (to publish Shorts).
- **Decision**: Request both scopes (`drive.file` and `youtube.upload`) in a single server-side OAuth flow with `access_type=offline` and `prompt=consent`. Encrypt all access and refresh tokens at rest with AES-256-GCM.
- **Consequences**: The user only logs in once. Plaintext credentials are never exposed to client-side code, Git, or logs. Background tasks can refresh expired tokens automatically using stored refresh tokens.

## ADR-007: Zero-RAM-Buffering 5MB Resumable Video Streaming
- **Context**: Serverless runtimes (Cloudflare Workers, edge functions) have strict memory caps (typically 128 MB RAM). Buffering an entire 50MB-200MB MP4 file into memory causes memory exhaustion (`OOM`) crashes.
- **Decision**: Use the Google Resumable Upload protocol (`uploadType=resumable`) with 5MB chunks (`5 * 1024 * 1024` bytes) using Web standard streams (`ReadableStream.getReader()`).
- **Consequences**: Peak memory consumption never exceeds ~10MB regardless of video size. Large videos transfer smoothly across Google Drive and YouTube.

## ADR-008: Safe Daily Quota Ceiling (5 uploads/day) for YouTube Data API v3
- **Context**: YouTube Data API v3 grants 10,000 units/day per Google Cloud project. Each video insertion costs 1,600 units. Publishing 7 videos in one day exhausts the quota completely, failing all subsequent API calls until midnight PST.
- **Decision**: Enforce an automated daily ceiling of `max_uploads_per_day = 5` (~8,000 units), preserving 2,000 units for channel checks, status queries, and metadata validation.
- **Consequences**: Protects against unexpected quota lockouts on the free tier.

## ADR-009: Decoupling from `googleapis` SDK in favor of Native Web Fetch
- **Context**: The official `googleapis` npm package is over 50MB and relies on Node.js-specific modules (`http`, `https`, `stream`) that fail or bloat Cloudflare Workers / Edge bundles.
- **Decision**: Build lightweight native API wrappers (`GoogleDriveService`, `YouTubeService`, `GoogleAuthService`) using the standard Web `fetch` API.
- **Consequences**: Zero bundle bloat, zero dependency conflicts, fast cold starts on Cloudflare Pages and Workers.

## ADR-010: Mandatory Minimum Local SSD Policy
- **Context**: Video automation workflows can quickly fill local SSD drives with multi-gigabyte video caches, build artifacts, and test fixtures.
- **Decision**: Formulate a mandatory architectural requirement that zero video binaries are stored on the developer's laptop SSD. All test suites generate synthetic in-memory streams (`createInMemoryTestVideo`), and automated clean scripts (`npm run clean`) purge build artifacts.
- **Consequences**: Prevents laptop disk wear, OneDrive sync thrashing, and unnecessary storage consumption.

## ADR-011: Direct Reel URL Submission as Primary Ingestion Flow
- **Context**: Meta aggressively restricts unauthenticated web scraping on public profile pages, rendering passive URL polling unreliable without session cookies or bot-like behavior.
- **Decision**: Make direct creator Reel URL submission (`/submit-reel`) the primary user flow. Users paste specific Reel links with explicit ownership/copyright confirmation.
- **Consequences**: Eliminates reliance on brittle scraping while maintaining seamless streaming into Google Drive and YouTube Shorts.

## ADR-012: Provider-Independent MediaResolver Chain
- **Context**: Different Reels originate from diverse sources: user-provided streams, creator CDN links, Google Drive files, Meta Graph API, or public links.
- **Decision**: Implement a decoupled provider hierarchy (`IMediaProvider`) via `MediaResolver` that probes sources in priority order and honestly reports `WAITING_FOR_AUTHORIZED_MEDIA` when platform session authentication is required.
- **Consequences**: Easy extensibility, clean testing with `SandboxTestProvider`, and zero anti-bot policy violations.

## ADR-013: Granular Pipeline State Machine
- **Context**: Moving from a binary "DETECTED" vs "COMPLETED" state to a multi-stage streaming pipeline required visibility into individual intermediate stages.
- **Decision**: Expand `JobStatus` to include `SUBMITTED`, `VALIDATING`, `RESOLVING_MEDIA`, `MEDIA_AVAILABLE`, `WAITING_FOR_AUTHORIZED_MEDIA`, `ARCHIVING_TO_DRIVE`, `STORED_IN_DRIVE`, `UPLOADING_TO_YOUTUBE`, `VERIFYING_UPLOAD`, `COMPLETED`, and `FAILED`.
- **Consequences**: Real-time observability on both the dashboard and worker cron, clear user messaging, and deterministic retry handling.

## ADR-014: Official Meta Business Discovery Architecture for Profile Monitoring
- **Context**: Monitoring creator profiles like `@zackdfilms` unauthenticated via HTTP GET returns an unhydrated React client shell (HTTP 200) without raw video binaries. Attempting to bypass login walls violates terms of service.
- **Decision**: Implement official Meta Graph API Business Discovery (`GET /{ig_user_id}?fields=business_discovery.username({username}){media{...}}`). The app authenticates via an authorized professional monitoring account and queries target accounts. When credentials are not configured or media is gated, it cleanly transitions to `AUTHORIZATION_REQUIRED` or `WAITING_FOR_AUTHORIZED_MEDIA`.
- **Consequences**: Fully compliant with Meta platform policies; zero scraping or proxy rotation; handles both Business and Creator accounts cleanly.

## ADR-015: Empirical Handling of Specific Reel URLs (Target: Dff42IfnIPz)
- **Context**: Tested live retrieval of specific Instagram Reel `https://www.instagram.com/reel/Dff42IfnIPz/` (shortcode: `Dff42IfnIPz`). Live HTTP probes confirmed the page is reachable (HTTP 200) and Meta oEmbed returns rich embed metadata, but unauthenticated web GET yields only an unhydrated React shell without raw MP4 binaries or direct video streams.
- **Decision**: Strictly reject private cookie theft, proxy evasion, headless scraping, or CAPTCHA bypasses. Accurately report `WAITING_FOR_AUTHORIZED_MEDIA` when unauthenticated. Accept creator-authorized direct media streams (S3/R2/CDN) or Google Drive attachments, and support official Meta Business Discovery when credentials are provided. Process all media strictly in RAM with zero disk writes.
- **Consequences**: Completely compliant with platform policies and intellectual property law; honest reporting of technical limitations without inventing URLs; guarantees zero local laptop SSD consumption.

## ADR-016: ReClip / yt-dlp Extractor Integration for Direct Progressive Streaming
- **Context**: ReClip (`averygan/reclip`) wraps `yt-dlp` to download media from Instagram and 1,000+ sites. However, its default implementation writes files directly to the local disk (`downloads/`), which violates AutoShorts' permanent minimum laptop SSD policy.
- **Decision**: Adapt ReClip's extraction logic into `ReClipYtDlpProvider` using `yt-dlp --no-playlist -j` in pure metadata mode without writing files to disk. Extract direct progressive MP4 stream URLs and pass them to AutoShorts' streaming pipeline (`GoogleDriveService.uploadStreamResumable`, `YouTubeService.uploadShortStreamResumable`) using 5MB bounded memory buffers. Support both local CLI execution and remote container microservices (`RECLIP_SERVICE_URL`). Mask signed query tokens in all logs.
- **Consequences**: Enables retrieval of original progressive MP4 binaries (e.g. 11.12 MB from Reel `Dff42IfnIPz`) without stolen cookies or CAPTCHA bypasses, completely eliminating local disk storage (0 bytes written to SSD).

## ADR-017: SSRF Hardening, Rate Limiting & Cloud-to-Cloud Resumable Transfer
- **Context**: Direct video submissions could theoretically target internal microservices or cloud metadata endpoints (`169.254.169.254`, `127.0.0.1`, RFC 1918 IPs). Furthermore, external ingestion endpoints require protection against spam/denial-of-service, and Google Drive uploads require verified chunking and file inspection.
- **Decision**: Enforce strict SSRF validation (`isValidPublicMediaUrl`) rejecting loopback, link-local metadata endpoints, private IP ranges, and non-HTTPS protocols (while permitting localhost only under explicit test flags). Implement sliding-window rate limiting on `/api/reels/submit` (30 requests/min). Add `GoogleDriveService.getFileMetadata` to verify uploaded file size, MIME type, and md5Checksum. Stream 11.12 MB media directly cloud-to-cloud via 5MB chunk buffers.
- **Consequences**: Hardened security against SSRF and DOS; guarantees verified file integrity on Google Drive without writing files to the developer's laptop SSD.
