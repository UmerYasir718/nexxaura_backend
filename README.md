# Nexxaura main_server

Node.js **API gateway** that combines:

1. **Office Ally → Availity** sync (JWT, Redis, Postgres, Playwright) — see [docs/OFFICE_ALLY_AVAILITY.md](docs/OFFICE_ALLY_AVAILITY.md)
2. **Medical transcription / coding middleman** — proxies to FastAPI with local validation — see [docs/MEDICAL_CODING_PROXY.md](docs/MEDICAL_CODING_PROXY.md)
3. **User-scoped data** — REST + GraphQL for appointments, patients, insurance, Availity summary

**Graphifyy (PyPI)** — separate dev tool: `pip install graphifyy` → static knowledge graph of the repo (`graph.html`, `graph.json`). See [docs/GRAPHIFY.md](docs/GRAPHIFY.md). This is **not** the same as `POST /graphql` in this server.

## Quick start

1. `cp .env.example .env` — set DB, Redis, `JWT_SECRET`, and optionally `MEDICAL_BACKEND_BASE_URL`
2. Apply SQL: `psql … -f sql/schema.sql` then `sql/seed.sql` (see [docs/OFFICE_ALLY_AVAILITY.md](docs/OFFICE_ALLY_AVAILITY.md) for migrations)
3. `npm install` && `npm run dev`

## Endpoints (short)

| Area | Base | Auth |
|------|------|------|
| Health (gateway) | `GET /health` | no |
| FastAPI health (proxied) | `GET /` | no |
| Auth | `POST /api/auth/login` | no |
| Sync (OA+Availity) | `POST /api/sync/date-sync` | yes |
| MFA / OTP | `POST /api/sync/otp` | yes |
| User data | `GET /api/data/*` | yes |
| **Create user (admin)** | `POST /api/users` | **admin only** |
| GraphQL counts | `POST /graphql` | yes |
| Medical API | `POST /api/transcribe`, `POST /api/coding/…` | no* |

\*Medical routes match your FastAPI contract; add gateway auth in front if you need it.

## Postman

- Sync / auth: `postman/nexxaura-main-server.postman_collection.json`
- **User data only** (appointments, patients, insurance, availity, dashboard): `postman/nexxaura-user-data.postman_collection.json`
- Medical proxy: `postman/medical-coding-proxy.postman_collection.json`

## Tests & CI

- `npm test` — local
- `npm run test:ci` — Jest with coverage (used in GitHub Actions: `.github/workflows/ci.yml`)
- Table-driven and `forEach` examples: `tests/medicalRules.test.js`, `tests/dataService.forEach.test.js`

## Sentry

- SDK is initialized from `instrument.js` (loaded first in both `src/server.js` and `src/worker.js`).
- Set `SENTRY_DSN` in environment (fallback key `dsn` is also supported for backward compatibility).
- Optional vars:
  - `SENTRY_TRACES_SAMPLE_RATE` (default `1.0`)
  - `SENTRY_PROFILE_SESSION_SAMPLE_RATE` (default `1.0`)
  - `SENTRY_PROFILE_LIFECYCLE` (default `trace`)
  - `SENTRY_ENABLE_LOGS` (default `true`)
  - `SENTRY_SEND_DEFAULT_PII` (default `true`)
  - `SENTRY_ENVIRONMENT` (default `development` / `docker-local`)
  - `SENTRY_TEST_ROUTE_ENABLED` (default `true` outside production)
- Verify by calling `GET /debug-sentry` and confirming event appears in Sentry.

## Security

- Never commit `.env` — it holds DB passwords and optional `MEDICAL_BACKEND_API_KEY`.
- Vendor credentials live in `office_ally_credentials` and `availity_credentials` (see SQL seed).
