# Technical Debt

Tracks known technical debt items across the codebase.

## Status Legend

- `OPEN` — Not yet addressed
- `RESOLVED` — Addressed; route/code no longer exists
- `WONTFIX` — Will not address

---

## TD-017 — Remove duplicate /form/index compatibility route

**Status:** RESOLVED
**Severity:** Low — Routes
**Resolved in:** WIC-67

The `/form/index` route was a backwards-compatibility alias for the old web app. The API was rewritten in TypeScript as part of WIC-43 and WIC-50 with structured route modules under `packages/api/src/routes/`. The legacy route was never carried forward into the new codebase — no cleanup was needed.

Confirmed: no calls to `/form/index` exist in the frontend (`packages/web/`) or any other package.
