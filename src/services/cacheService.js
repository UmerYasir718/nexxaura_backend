const env = require('../config/env');
const m = require('../metrics/prometheus');
const { SERVICE } = m;

const CACHE_NAME = 'redis';
const mem = new Map();
// Bump when cached payload shape changes (e.g. strip raw fields from user data).
const keyPrefix = 'cache:v2:';

function k(name, parts) {
  return `${keyPrefix}${name}:${parts.map((p) => String(p)).join(':')}`;
}

function memGet(key) {
  const e = mem.get(key);
  if (!e) return { hit: false, value: null };
  if (Date.now() > e.exp) {
    mem.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: e.value };
}

function memSet(key, value, ttlSec) {
  mem.set(key, { value, exp: Date.now() + ttlSec * 1000 });
}

/**
 * @param {string} name
 * @param {string} userId
 * @param {() => Promise<T>} loader
 * @param {number} [ttlSec]
 * @template T
 */
async function getOrSet(name, userId, loader, ttlSec) {
  const sec = ttlSec == null ? env.dashboardCacheTtlSec : ttlSec;
  const cacheKey = k(name, [userId]);

  if (process.env.NODE_ENV === 'test') {
    const memKey = `mem:${name}:${userId}`;
    const { hit, value: mv } = memGet(memKey);
    if (hit) {
      m.cacheHits.inc({ name, cache: 'memory', service: SERVICE });
      m.cacheLatency.observe({ op: 'get', name, service: SERVICE }, 0.0001);
      return /** @type {T} */ (JSON.parse(/** @type {string} */ (mv)));
    }
    m.cacheMisses.inc({ name, cache: 'memory', service: SERVICE });
    const t0 = process.hrtime.bigint();
    const data = await loader();
    memSet(memKey, JSON.stringify(data), sec);
    m.cacheLatency.observe({ op: 'get_set', name, service: SERVICE }, Number(process.hrtime.bigint() - t0) / 1e9);
    return data;
  }

  const redis = require('../config/redis');
  const t0g = process.hrtime.bigint();
  const raw = await redis.get(cacheKey);
  m.cacheLatency.observe({ op: 'get', name, service: SERVICE }, Number(process.hrtime.bigint() - t0g) / 1e9);
  if (raw) {
    m.cacheHits.inc({ name, cache: CACHE_NAME, service: SERVICE });
    return /** @type {T} */ (JSON.parse(/** @type {string} */ (raw)));
  }
  m.cacheMisses.inc({ name, cache: CACHE_NAME, service: SERVICE });
  const t0 = process.hrtime.bigint();
  const data = await loader();
  m.cacheLatency.observe({ op: 'load', name, service: SERVICE }, Number(process.hrtime.bigint() - t0) / 1e9);
  const t1 = process.hrtime.bigint();
  await redis.set(cacheKey, JSON.stringify(data), 'EX', sec);
  m.cacheLatency.observe({ op: 'set', name, service: SERVICE }, Number(process.hrtime.bigint() - t1) / 1e9);
  return data;
}

/**
 * @param {string} userId
 */
async function invalidateUserDashboard(userId) {
  const redis = require('../config/redis');
  if (process.env.NODE_ENV === 'test') {
    const memKey = `mem:dashboard:${userId}`;
    mem.delete(memKey);
    return;
  }
  await redis.del(k('dashboard', [userId]));
}

module.exports = { getOrSet, invalidateUserDashboard, _key: k, _name: CACHE_NAME };
