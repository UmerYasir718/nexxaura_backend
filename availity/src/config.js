import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const DEFAULT_ELIGIBILITY_APP_URL =
  "https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpres%2Fweb%2Feligibility%2F";

function bool(v, defaultValue = false) {
  if (v === undefined || v === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function int(v, defaultValue) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizeEligibilityAppUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return DEFAULT_ELIGIBILITY_APP_URL;
  if (/\/static\/web\/pres\/web\/eligibility\/?/i.test(value)) return value;
  if (/appUrl=.*eligibility/i.test(value)) return value;
  if (/onboarding-ui-apps\/navigation\/?(#\/?)?$/i.test(value)) {
    return DEFAULT_ELIGIBILITY_APP_URL;
  }
  return value;
}

/** @typedef {{ host: string, port: number, database: string, user: string, password: string, ssl: any }} PgConfig */

/** @returns {AvailityRootConfig} */
export function loadAvailityConfig() {
  return {
    headless: bool(process.env.HEADLESS, true),
    slowMoMs: int(process.env.SLOW_MO_MS, 0),
    screenshotDir: process.env.SCREENSHOT_DIR || "./screenshots",
    pg: {
      host: process.env.PGHOST || "localhost",
      port: int(process.env.DB_PORT || process.env.PGPORT, 2926),
      database: process.env.DB_NAME || "nexxaura_new",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "",
      ssl: bool(process.env.DB_SSL, false)
        ? { rejectUnauthorized: false }
        : false,
    },
    availity: {
      /**
       * Playwright storage state JSON path (cookies/session). Set to empty or "0" to disable.
       * Default: availity-auth.json next to availity/.env
       */
      storageStatePath: (() => {
        const v = process.env.AVAILITY_STORAGE_STATE;
        if (v === "" || v === "0" || v === "false") return "";
        if (v) return path.isAbsolute(v) ? v : path.resolve(__dirname, "..", v);
        return path.resolve(__dirname, "../availity-auth.json");
      })(),
      loginUrl:
        process.env.AVAILITY_LOGIN_URL ||
        "https://essentials.availity.com/static/public/onb/onboarding-ui-apps/availity-fr-ui/#/login",
      eligibilityAppUrl: normalizeEligibilityAppUrl(
        process.env.AVAILITY_ELIGIBILITY_URL || DEFAULT_ELIGIBILITY_APP_URL,
      ),
      username: process.env.AVAILITY_USERNAME || "",
      password: process.env.AVAILITY_PASSWORD || "",
      organizationQuery: process.env.AVAILITY_ORG_QUERY || "OPEN MIND HEALTH",
      organizationOptionRegex:
        process.env.AVAILITY_ORG_OPTION_RE || "OPEN MIND HEALTH",
      providerQuery:
        process.env.AVAILITY_PROVIDER_QUERY ||
        "OPEN MIND MENTAL HEALTH PHYSICIANS",
      providerOptionRegex:
        process.env.AVAILITY_PROVIDER_OPTION_RE ||
        "OPEN MIND MENTAL HEALTH PHYSICIANS",
      benefitServiceTypeQuery:
        process.env.AVAILITY_SERVICE_TYPE_QUERY ||
        "Health Benefit Plan Coverage - 30",
      benefitServiceTypeOptionRe:
        process.env.AVAILITY_SERVICE_TYPE_OPTION_RE ||
        "Health Benefit Plan Coverage\\s*-\\s*30",
      patientSearchOptionQuery:
        process.env.AVAILITY_PATIENT_SEARCH_OPTION_QUERY || "Member ID",
      subscriberRelationshipQuery:
        process.env.AVAILITY_SUBSCRIBER_RELATIONSHIP_QUERY || "Self",
      maxPatientsPerRun: int(process.env.AVAILITY_MAX_PATIENTS_PER_RUN, 25),
      stopOnFirstError: bool(process.env.AVAILITY_STOP_ON_ERROR, false),
      contentFrameSelector:
        process.env.AVAILITY_CONTENT_FRAME || "iframe#newBodyFrame",
      /** Substring or phrase to match the MFA method row (Authenticator app). */
      mfaAuthenticatorMethodText:
        process.env.AVAILITY_MFA_AUTHENTICATOR_TEXT ||
        "Authenticate me using my Authenticator app",
      /** Max time to wait on the OTP / challenge screen for manual entry (ms). 0 => wait forever. */
      mfaWaitTimeoutMs: int(process.env.AVAILITY_MFA_WAIT_MS, 0),
      /** Keep result screen open before parsing (ms) for manual DOM study/debug. */
      resultScreenDelayMs: int(process.env.AVAILITY_RESULT_SCREEN_DELAY_MS, 0),
    },
  };
}

export function assertAvailityEnv(config) {
  const missing = [];
  if (!config.availity.username) missing.push("AVAILITY_USERNAME");
  if (!config.availity.password) missing.push("AVAILITY_PASSWORD");
  if (!config.pg.database) missing.push("DB_NAME");
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(", ")}. Copy availity/.env.example to availity/.env`,
    );
  }
}
