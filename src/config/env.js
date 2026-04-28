const dotenv = require('dotenv');

dotenv.config();

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function boolEnv(name, def) {
  if (process.env[name] == null || process.env[name] === '') return def;
  return String(process.env[name]).toLowerCase() === 'true' || process.env[name] === '1';
}

module.exports = {
  serviceName: process.env.SERVICE_NAME || 'nexxaura-node',
  port: Number(process.env.PORT || 4000),
  workerMetricsPort: Number(process.env.WORKER_METRICS_PORT || 9109),
  appVersion: process.env.APP_VERSION || process.env.GIT_SHA || 'dev',
  metricsEnabled: boolEnv('METRICS_ENABLED', true),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  useSyncQueue: boolEnv('USE_SYNC_QUEUE', process.env.NODE_ENV !== 'test'),
  /** BullMQ: enable background sync jobs via Redis (set false in tests or without Redis) */
  dashboardCacheTtlSec: Number(process.env.DASHBOARD_CACHE_TTL_SEC || 30),
  pg: {
    statementTimeoutMs: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30000),
    connectTimeoutMs: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
    maxPoolSize: Number(process.env.PG_MAX_POOL || 20),
  },
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: boolEnv('PG_SSL', false),
  postgres: {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'nexxaura_main',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  },
  officeAlly: {
    baseUrl: process.env.OA_BASE_URL || 'https://pm.officeally.com/pm/',
    headless: String(process.env.OA_HEADLESS || 'true').toLowerCase() === 'true',
  },
  /** FastAPI medical backend (transcription + coding) — do not commit real URLs/keys; use .env */
  medicalBackend: {
    baseUrl: (process.env.MEDICAL_BACKEND_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    timeoutMs: Number(process.env.MEDICAL_BACKEND_TIMEOUT_MS || 300000),
    /** Health/root probe: separate shorter timeout for FastAPI liveness */
    healthTimeoutMs: Number(process.env.MEDICAL_BACKEND_HEALTH_TIMEOUT_MS || 10000),
    /** Optional: forward to FastAPI (if you add API key auth upstream) */
    apiKey: process.env.MEDICAL_BACKEND_API_KEY || '',
  },
  /** Simple sliding-window rate limit for /api (medical) routes — can tune per environment */
  medicalRateLimit: {
    windowMs: Number(process.env.MEDICAL_RATE_WINDOW_MS || 60_000),
    max: Number(process.env.MEDICAL_RATE_MAX || 120),
  },
  bull: {
    syncConcurrency: Number(process.env.BULL_SYNC_CONCURRENCY || 1),
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 20,
    },
  },
  cors: {
    origins: parseCorsOrigins(),
    allowAll: !process.env.CORS_ORIGINS || !process.env.CORS_ORIGINS.trim(),
  },
  /** Same limits as typical FastAPI config; enforced before proxy */
  medicalLimits: {
    maxAudioMb: Number(process.env.MEDICAL_MAX_AUDIO_MB || 100),
    maxDiagnosisPdfMb: Number(process.env.MEDICAL_MAX_DIAGNOSIS_PDF_MB || 50),
    minExtractedChars: Number(process.env.MEDICAL_MIN_EXTRACTED_CHARS || 50),
  },
};
