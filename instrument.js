const dotenv = require('dotenv');
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

dotenv.config();

const dsn = process.env.SENTRY_DSN || process.env.dsn || '';

if (dsn) {
  Sentry.init({
    dsn,
    integrations: [nodeProfilingIntegration()],
    enableLogs: String(process.env.SENTRY_ENABLE_LOGS || 'true').toLowerCase() === 'true',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 1.0),
    profileSessionSampleRate: Number(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE || 1.0),
    profileLifecycle: process.env.SENTRY_PROFILE_LIFECYCLE || 'trace',
    sendDefaultPii: String(process.env.SENTRY_SEND_DEFAULT_PII || 'true').toLowerCase() === 'true',
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  });
}

module.exports = Sentry;
