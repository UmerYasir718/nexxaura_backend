const path = require('path');

const DEFAULT_ELIGIBILITY_APP_URL =
  'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpres%2Fweb%2Feligibility%2F';

function int(v, defaultValue) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function bool(v, defaultValue = false) {
  if (v === undefined || v === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function normalizeEligibilityAppUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return DEFAULT_ELIGIBILITY_APP_URL;
  if (/\/static\/web\/pres\/web\/eligibility\/?/i.test(value)) return value;
  if (/appUrl=.*eligibility/i.test(value)) return value;
  if (/onboarding-ui-apps\/navigation\/?(#\/?)?$/i.test(value)) {
    return DEFAULT_ELIGIBILITY_APP_URL;
  }
  return value;
}

/**
 * Mirrors scripts/availity/src/config.js loadAvailityConfig shape (top-level + nested availity).
 * Username/password come from the DB, not from env.
 */
function buildAvailityConfig({ avUsername, avPassword }) {
  return {
    headless: bool(process.env.HEADLESS, true),
    slowMoMs: int(process.env.SLOW_MO_MS, 0),
    pg: {
      /* pg section unused by browser flow but some scraper exports expect config root */
    },
    availity: {
      storageStatePath: (() => {
        const v = process.env.AVAILITY_STORAGE_STATE;
        if (v === '' || v === '0' || v === 'false') return '';
        if (v) return path.isAbsolute(v) ? v : path.resolve(process.cwd(), v);
        return path.resolve(process.cwd(), 'availity', 'availity-auth.json');
      })(),
      loginUrl:
        process.env.AVAILITY_LOGIN_URL ||
        'https://essentials.availity.com/static/public/onb/onboarding-ui-apps/availity-fr-ui/#/login',
      eligibilityAppUrl: normalizeEligibilityAppUrl(process.env.AVAILITY_ELIGIBILITY_URL),
      username: avUsername,
      password: avPassword,
      organizationQuery: process.env.AVAILITY_ORG_QUERY || 'OPEN MIND HEALTH',
      organizationOptionRegex: process.env.AVAILITY_ORG_OPTION_RE || 'OPEN MIND HEALTH',
      providerQuery: process.env.AVAILITY_PROVIDER_QUERY || 'OPEN MIND MENTAL HEALTH PHYSICIANS',
      providerOptionRegex: process.env.AVAILITY_PROVIDER_OPTION_RE || 'OPEN MIND MENTAL HEALTH PHYSICIANS',
      benefitServiceTypeQuery: process.env.AVAILITY_SERVICE_TYPE_QUERY || 'Health Benefit Plan Coverage - 30',
      benefitServiceTypeOptionRe: process.env.AVAILITY_SERVICE_TYPE_OPTION_RE || 'Health Benefit Plan Coverage\\s*-\\s*30',
      patientSearchOptionQuery: process.env.AVAILITY_PATIENT_SEARCH_OPTION_QUERY || 'Member ID',
      subscriberRelationshipQuery: process.env.AVAILITY_SUBSCRIBER_RELATIONSHIP_QUERY || 'Self',
      maxPatientsPerRun: int(process.env.AVAILITY_MAX_PATIENTS_PER_RUN, 10),
      stopOnFirstError: bool(process.env.AVAILITY_STOP_ON_ERROR, false),
      contentFrameSelector: process.env.AVAILITY_CONTENT_FRAME || 'iframe#newBodyFrame',
      mfaAuthenticatorMethodText: process.env.AVAILITY_MFA_AUTHENTICATOR_TEXT || 'Authenticate me using my Authenticator app',
      mfaWaitTimeoutMs: int(process.env.AVAILITY_MFA_WAIT_MS, 0),
      resultScreenDelayMs: int(process.env.AVAILITY_RESULT_SCREEN_DELAY_MS, 0),
    },
  };
}

module.exports = { buildAvailityConfig, DEFAULT_ELIGIBILITY_APP_URL };
