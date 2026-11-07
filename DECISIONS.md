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
