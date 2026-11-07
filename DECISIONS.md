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
- **Decision**: Extract the first line of the caption as the YouTube title (capped at 70-100 characters) and retain the full caption text as the YouTube description.
- **Consequences**: Maximizes organic CTR on YouTube Shorts while preserving the creator's full copy, links, and hashtags in the description.

## ADR-005: Cloudflare D1 Compatibility
- **Context**: Cloudflare D1 uses SQLite, which differs from PostgreSQL in types (no native UUID or TIMESTAMPTZ).
- **Decision**: Store timestamps as ISO 8601 text (`YYYY-MM-DDTHH:MM:SS.sssZ`) and booleans as integer 0/1, maintaining full SQL compatibility with D1.
