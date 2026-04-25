# Availity — Eligibility and Benefits Inquiry

Automates **Availity Essentials** login, opens the **Eligibility** micro-app inside the shell **iframe**, fills **Eligibility and Benefits Inquiry** from **database-driven** patient + primary insurance, **submits**, and stores **parsed** coverage/benefit fields. Code is **function-based** (`runAvailityEligibility`, `availity*` functions in `eligibilityScraper.js`).

## Prerequisites

- Node 18+
- Same PostgreSQL as Office Ally, with **`../sql/schema.sql`** applied (includes `availity_eligibility_*` tables).
- **Office Ally sync should run first** so `patients` and `patient_insurance` (rank 1) have `member_id`, `payer_name`, and `date_of_birth`.

## Who gets queued

`listPrimaryInsuranceForAvaility` selects patients where:

- `patient_insurance.coverage_rank = 1`
- `member_id` and `payer_name` are non-empty
- `patients.date_of_birth` is set  

Up to **`AVAILITY_MAX_PATIENTS_PER_RUN`** rows (default 25), ordered by `last_synced_at`.

## Environment

Copy `.env.example` to **`.env`** in this folder (`availity/.env`).

| Variable | Role |
|----------|------|
| `AVAILITY_USERNAME` / `AVAILITY_PASSWORD` | Availity login (required). |
| `AVAILITY_LOGIN_URL` | Optional; default is the Essentials **FR login** hash URL. |
| `AVAILITY_ELIGIBILITY_URL` | Optional; default loads the **eligibility** app in the navigation shell. |
| `AVAILITY_MAX_PATIENTS_PER_RUN` | Max DB rows per run (default 25). |
| `AVAILITY_STOP_ON_ERROR` | If `true`, stop after the first patient failure. |
| `AVAILITY_ORG_QUERY`, `AVAILITY_ORG_OPTION_RE`, `AVAILITY_PROVIDER_*`, `AVAILITY_SERVICE_TYPE_*`, … | Override fixed inquiry defaults (organization, provider, service type). |
| `AVAILITY_CONTENT_FRAME` | Iframe hosting the React app (default `iframe#newBodyFrame`). |
| `SEL_AVAILITY_USER`, `SEL_AVAILITY_PASS`, `SEL_AVAILITY_SUBMIT` | Optional login field overrides. |
| `AVAILITY_MFA_AUTHENTICATOR_TEXT` | Phrase to match the **Authenticator app** MFA option (default: full Availity label). |
| `AVAILITY_MFA_WAIT_MS` | Max wait (ms) for authenticator code after **Continue**. **`0` = wait indefinitely.** Default `0`. Use `HEADLESS=false` to type the code in the browser. |
| `AVAILITY_STORAGE_STATE` | Path to Playwright **storage state** JSON (cookies/session). Default `availity-auth.json` beside `availity/.env`. Set `0` or `false` to disable save/load. |
| `HEADLESS`, `SCREENSHOT_DIR`, `PG*` | Same idea as Office Ally package. |
| `AVAILITY_LOG_FILE` | Optional log path. |

## Working flow (step by step)

Orchestrator: **`src/runEligibility.js`** → **`runAvailityEligibility({ config, logger, browser, db })`**.

### 1. Load queue from DB

- If no rows: log warning and exit (run Office Ally sync first).

### 2. Browser launch

- Playwright Chromium; same screenshot/log pattern as Office Ally.

### 3. Login (`eligibilityScraper.js` → `availityLogin`)

1. **`page.goto(AVAILITY_LOGIN_URL)`** (or default FR UI login URL).
2. **Cookie banners** — best-effort clicks (`Allow All Cookies`, OneTrust handlers, etc.).
3. **Credentials** — fills first visible match from `SEL_AVAILITY_USER` / `SEL_AVAILITY_PASS` CSV lists (or built-in fallbacks), then submits via `SEL_AVAILITY_SUBMIT` fallbacks.
4. **MFA (Authenticator app)** — if Availity shows the method picker, the script selects **Authenticate me using my Authenticator app**, clicks **Continue**, then **waits** until you enter the one-time code in the browser and the session reaches a logged-in state (up to `AVAILITY_MFA_WAIT_MS`). If that UI does not appear, login continues without this step.
5. Short wait; cookie banner may appear again after redirect.

**Screenshot:** `availity-after-login`.

### 4. Per patient in the queue

For each row (`payer_name`, `member_id`, `date_of_birth`, `patient_id`, `pm_patient_id`):

1. **`startAvailityRun`** — insert into `availity_eligibility_runs` with status `running`.

2. **`availityOpenEligibilityApp`** — `page.goto(AVAILITY_ELIGIBILITY_URL)` so the shell loads the **eligibility** hash app; cookies again if needed.

3. **`availityGetContentFrame`** — attaches to **`iframe#newBodyFrame`** (or `AVAILITY_CONTENT_FRAME`). All form interaction happens **inside this frame**.

4. **Wait** for `#organization-field` (inquiry form ready).

5. **`availityFillInquiryForm`** (MUI autocompletes + date sections):

   | UI field | Source / constant |
   |----------|-------------------|
   | Organization | Config default **OPEN MIND HEALTH** (autocomplete pick). |
   | Payer | **`payer_name`** from DB (`patient_insurance`). |
   | Provider | Config default **OPEN MIND MENTAL HEALTH PHYSICIANS** + NPI **1093454423** (with NPI-only fallback). |
   | Patient search option / subscriber relationship | Optional autocompletes: **Member ID**, **Self** (if visible). |
   | Patient ID (`input[name="memberId"]`) | **`member_id`** from DB (subscriber / member id from PM). |
   | Date of birth | **`patients.date_of_birth`** → US **MM/DD/YYYY** into MUI date sections. |
   | As of date | **Today** (US format). |
   | Benefit / service type | Default **Health Benefit Plan Coverage - 30**. |

6. **Screenshot** `availity-filled-{pm_patient_id}`.

7. **`availitySubmitInquiry`** — clicks **Submit** in the frame.

8. **`availityWaitForResponse`** — waits for result UI: **Member ID** row, **Active Coverage** / similar text, or **`.MuiAlert-message`** (error).

9. **`availityParseResponseSnapshot`** — `page.evaluate` in the frame: reads **`.patient-card-extended-label`**, chip text, plan/insurance type paragraphs, patient name / benefit line from the **list-group** header.

10. If **`alertText`** is set → treat as failure and store run message.

11. Else **`mapAvailitySnapshotToResultRow`** → **`insertAvailityResult`** into `availity_eligibility_results`, **`finishAvailityRun`** success.

12. **Screenshots** `availity-result-*` or `availity-error-*`.

Between patients the eligibility URL is opened again to reset the form.

### 5. Cleanup

- **`browser.close()`** in a `finally` block so the browser always closes.

## Database tables (written by this package)

| Table | Content |
|-------|---------|
| `availity_eligibility_runs` | One row per attempt: `patient_id`, payer/member snapshot, `status`, `message`, timestamps. |
| `availity_eligibility_results` | Parsed fields: coverage chip text, `is_active`, member/payer ids on response, plan/product, insurance type, coverage level, **`raw_snapshot` JSONB** (full parser output). |

Reads **`patients`** and **`patient_insurance`**; does not modify them.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Empty queue | Run Office Ally sync; ensure rank **1** insurance has **member_id**, **payer_name**, patient **DOB**. |
| Login fails | `SEL_AVAILITY_*` overrides; try `HEADLESS=false` and watch the FR login page. |
| Iframe timeout | VPN / session; confirm `AVAILITY_CONTENT_FRAME` matches your shell. |
| Autocomplete / payer errors | Payer label in Availity may not match PM `payer_name` — align naming or extend picker logic in `eligibilityScraper.js`. |
| Date fields wrong | MUI multi-section dates use **Ctrl+A** then type; OS/layout differences may need a small scraper tweak. |

## Source map

| Path | Responsibility |
|------|----------------|
| `src/index.js` | Config, logger, db, browser; calls `runAvailityEligibility`. |
| `src/runEligibility.js` | Per-patient loop, repos, screenshots. |
| `src/eligibilityScraper.js` | Login, iframe, form fill, submit, wait, parse, **`mapAvailitySnapshotToResultRow`**. |
| `src/browser.js` | `createBrowser` — launch, screenshot, close. |
| `src/config.js` | `loadAvailityConfig`, `assertAvailityEnv`. |
| `src/repos/insuranceQueueRepo.js` | `listPrimaryInsuranceForAvaility`. |
| `src/repos/availityEligibilityRepo.js` | Start/finish run, insert result. |

## Commands

```bash
npm install
npm run eligibility
# or
npm start
```
