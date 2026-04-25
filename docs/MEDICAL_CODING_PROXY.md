# Medical coding & transcription **proxy** (middleman)

The Nexxaura Node gateway can sit **in front of** the Python **FastAPI** “Medical Transcription / Coding” service. This process does **not** reimplement the ML pipelines; it:

1. **Validates** file type / size (and some body rules) before calling upstream.
2. **Forwards** the request to the FastAPI base URL (`MEDICAL_BACKEND_BASE_URL`).
3. **Preserves** response shapes and status codes (including `detail` for validation errors and SSE streams for streaming routes).

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

## Path compatibility

The proxy mounts routes on the **same paths** as the spec you provided:

- `GET /` → FastAPI `GET /` (upstream health: “Medical Transcription API”).
- `GET /health` and `GET /gateway/health` → **this service only** (Nexxaura gateway liveness; does not call Python).
- `POST /api/transcribe`, `POST /api/download/*`, `POST /api/coding/*` → proxied to `${MEDICAL_BACKEND_BASE_URL}…`.

## Validation (middleman)

| Route | Local checks |
|--------|----------------|
| `POST /api/transcribe` | Extension in `.flac, .m4a, .mp3, .ogg, .wav, .webm`; size ≤ `MEDICAL_MAX_AUDIO_MB` |
| `POST /api/coding/upload-and-code*` | `.txt` or `.pdf` |
| `POST /api/coding/upload-diagnosis-pdf` | `.pdf`, magic `%PDF` in first 4 bytes, size ≤ `MEDICAL_MAX_DIAGNOSIS_PDF_MB` |
| JSON coding routes | `summary_report` non-empty for assign-codes |

## Streaming (SSE)

- `POST /api/coding/assign-codes-stream` and `upload-and-code-stream` are streamed with `responseType: 'stream'` and piped to the client.

## Axios errors

If the upstream is down, the gateway returns **502** with a JSON `{ "detail": "…" }` when possible, or the upstream error body on non-network failures.

## Postman

Use `postman/medical-coding-proxy.postman_collection.json` and point `baseUrl` at the **gateway** (e.g. `http://127.0.0.1:4000`).

## Tests

- Validation: `tests/medicalRules.test.js` (Jest `test.each` and array checks).
- CI: `.github/workflows/ci.yml` runs `npm run test:ci` on push/PR.

## Relationship to “Office Ally → Availity”

That flow is **independent** (our DB + Playwright + Availity scraper). The medical API proxy only talks to FastAPI. Both can be enabled in the same process.
