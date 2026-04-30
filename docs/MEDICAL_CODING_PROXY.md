# Medical independent flows **proxy** (middleman)

The Nexxaura Node gateway sits **in front of** the Python FastAPI medical service and proxies the `independent_flows` APIs:

1. **Validates** key required fields (and file type/size where applicable).
2. **Forwards** requests to `MEDICAL_BACKEND_BASE_URL`.
3. **Preserves** upstream status codes and response payloads.

## Configuration (sensitive — use `.env`, never commit)

| Variable | Purpose |
|----------|--------|
| `MEDICAL_BACKEND_BASE_URL` | FastAPI root, e.g. `http://127.0.0.1:8000` (no trailing slash) |
| `MEDICAL_BACKEND_API_KEY` | Optional Bearer token if your FastAPI is protected |
| `MEDICAL_BACKEND_TIMEOUT_MS` | Upstream request timeout (large PDFs / LLM) |
| `CORS_ORIGINS` | Comma list for browser clients (e.g. `http://localhost:3000`) |
| `MEDICAL_MAX_AUDIO_MB` | Default 100 — gate before proxy |
| `MEDICAL_MAX_DIAGNOSIS_PDF_MB` | Default 50 — gate before proxy |

**The gateway does not need** `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, or `LLAMA_CLOUD_API_KEY` in `.env` unless you run logic **here**; those belong on the FastAPI host.

## Independent flow endpoints

The proxy exposes these endpoints:

- `POST /api/independent/transcribe-audio`
- `POST /api/independent/generate-report`
- `POST /api/independent/parse-pdf`
- `POST /api/independent/code-icd`
- `POST /api/independent/code-cpt`
- `POST /api/independent/denial-prevention`
- `POST /api/independent/risk-mitigation`

## Required input checks (gateway)

| Route | Local checks |
|--------|----------------|
| `POST /api/independent/transcribe-audio` | Audio extension + size ≤ `MEDICAL_MAX_AUDIO_MB` |
| `POST /api/independent/parse-pdf` | Valid PDF signature + size ≤ `MEDICAL_MAX_DIAGNOSIS_PDF_MB` |
| `POST /api/independent/generate-report` | `transcript` required |
| `POST /api/independent/code-icd` | `summary_report` required |
| `POST /api/independent/code-cpt` | `summary_report` required |
| `POST /api/independent/denial-prevention` | `summary_report`, `specialty`, `codes[]` required |
| `POST /api/independent/risk-mitigation` | `summary_report`, `specialty`, `codes[]`, `denial_report` required |

## Postman

Use `postman/medical-coding-proxy.postman_collection.json` and point `baseUrl` at the gateway (e.g. `http://127.0.0.1:4000`).

## Tests

- Validation helpers: `tests/medicalRules.test.js`.
- CI: `.github/workflows/ci.yml` runs `npm run test:ci`.
