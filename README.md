# Steam Hour Booster — Multi-user Edition
Features:
- User registration & login
- Each user can add multiple Steam accounts to farm
- Steam Guard mobile support (local TOTP via shared_secret) or manual code entry
- Per-account start/stop farm controls
- Purple "cosmic" themed UI
- SQLite persistence (suitable for testing). For production use Postgres/Redis.

Instructions:
1. Copy `.env.example` to `.env` and fill secrets.
2. `npm install`
3. `npm start`
