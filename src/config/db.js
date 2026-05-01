const { Pool } = require('pg');
const env = require('./env');
const { incrementDbQuery } = require('../context/alsContext');
const m = require('../metrics/prometheus');
const { SERVICE } = m;

const statementTimeoutMs = Math.max(100, env.pg.statementTimeoutMs);
const lockTimeoutMs = Math.min(statementTimeoutMs, 15000);
const pgOptions = `-c search_path=public -c statement_timeout=${statementTimeoutMs} -c lock_timeout=${lockTimeoutMs}`;
const QUERY_WRAPPED = Symbol('nexxauraQueryWrapped');
let hasLoggedFirstConnect = false;

function describeDbTarget() {
  if (env.databaseUrl) {
    try {
      const u = new URL(env.databaseUrl);
      const dbName = String(u.pathname || '/').replace(/^\//, '') || 'unknown';
      return `${u.hostname}/${dbName}`;
    } catch {
      return 'database_url';
    }
  }
  return `${env.postgres.host}/${env.postgres.database}`;
}

const pool = new Pool({
  ...(env.databaseUrl ? { connectionString: env.databaseUrl } : env.postgres),
  ...(env.pgSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: env.pg.maxPoolSize,
  connectionTimeoutMillis: env.pg.connectTimeoutMs,
  idleTimeoutMillis: 30_000,
  options: pgOptions,
});

pool.on('connect', () => {
  if (!hasLoggedFirstConnect) {
    hasLoggedFirstConnect = true;
    // eslint-disable-next-line no-console
    console.log(`[db] connected: ${describeDbTarget()} ssl=${env.pgSsl ? 'on' : 'off'}`);
  }
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error:', err?.message || err);
});

function updatePoolGauges() {
  m.poolTotal.set({ service: SERVICE }, pool.totalCount);
  m.poolIdle.set({ service: SERVICE }, pool.idleCount);
  m.poolWaiting.set({ service: SERVICE }, pool.waitingCount);
}

if (env.metricsEnabled) {
  setInterval(updatePoolGauges, 5000);
  updatePoolGauges();
}

function wrapQueryText(text) {
  if (typeof text === 'string') {
    if (text.slice(0, 6).toLowerCase() === 'select') return 'select';
    if (text.slice(0, 6).toLowerCase() === 'insert') return 'insert';
    if (text.slice(0, 6).toLowerCase() === 'update') return 'update';
    if (text.slice(0, 6).toLowerCase() === 'delete') return 'delete';
  }
  return 'other';
}

/**
 * @param {string|import('pg').QueryConfig} text
 * @param {unknown[]} [params]
 */
async function query(text, params) {
  const op = wrapQueryText(typeof text === 'string' ? text : String(text.text || 'other'));
  incrementDbQuery();
  m.dbQueries.inc({ service: SERVICE, op });
  const t0 = process.hrtime.bigint();
  try {
    return await pool.query(text, params);
  } finally {
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    m.dbDuration.observe({ service: SERVICE, op }, sec);
  }
}

/**
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  if (client[QUERY_WRAPPED]) {
    return client;
  }
  const orig = client.query.bind(client);
  client.query = (text, params) => {
    incrementDbQuery();
    const op = wrapQueryText(typeof text === 'string' ? text : String((text && text.text) || 'other'));
    m.dbQueries.inc({ service: SERVICE, op });
    const t0 = process.hrtime.bigint();
    return orig(text, params).finally(() => {
      m.dbDuration.observe({ service: SERVICE, op }, Number(process.hrtime.bigint() - t0) / 1e9);
    });
  };
  client[QUERY_WRAPPED] = true;
  return client;
}

module.exports = {
  query,
  getClient,
  pool,
  close: () => pool.end(),
};
