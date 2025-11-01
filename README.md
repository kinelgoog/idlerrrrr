# Steam Hour Booster (refactor)
Refactored secure Steam farming manager with mobile Steam Guard support (local TOTP), SQLite persistence, Express web UI, and exponential backoff to reduce RateLimit issues.

## Quick start
1. Copy `.env.example` to `.env` and fill environment variables.
2. Install deps: `npm install`
3. Start: `npm start`

## Notes for Render.com
- Use a Background Worker for long-lived bot connections if possible.
- Prefer a managed database (Postgres) for production; SQLite is fine for testing.
- Do NOT commit `.env`.

