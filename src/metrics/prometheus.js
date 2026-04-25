const { collectDefaultMetrics, Registry, Counter, Gauge, Histogram } = require('prom-client');
const { performance } = require('node:perf_hooks');
const env = require('../config/env');

const SERVICE = env.serviceName;

const register = new Registry();

if (env.metricsEnabled) {
  collectDefaultMetrics({ register, prefix: 'node_', labels: { service: SERVICE } });
}

const httpInFlight = new Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests being processed',
  labelNames: ['service'],
  registers: [register],
});
const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status', 'service'],
  buckets: [0.01, 0.03, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});
const httpTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status', 'service'],
  registers: [register],
});
const httpAuthFailures = new Counter({
  name: 'http_auth_failures_total',
  help: 'Auth failures (401, 403)',
  labelNames: ['type', 'service', 'route'],
  registers: [register],
});
const httpRateLimitBlocks = new Counter({
  name: 'http_rate_limit_rejections_total',
  help: 'Rate limiter rejections',
  labelNames: ['route', 'service'],
  registers: [register],
});
const dbQueries = new Counter({
  name: 'db_queries_total',
  help: 'Postgres query count',
  labelNames: ['service', 'op'],
  registers: [register],
});
const dbDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Postgres query duration',
  labelNames: ['service', 'op'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [register],
});
const requestDbQueryCount = new Histogram({
  name: 'http_request_db_query_count',
  help: 'DB queries per HTTP request (N+1 signal)',
  labelNames: ['route', 'method', 'service'],
  buckets: [0, 1, 2, 3, 5, 8, 13, 21, 34, 50, 100],
  registers: [register],
});
const poolTotal = new Gauge({
  name: 'db_pool_size_total',
  help: 'Postgres pool total client count',
  labelNames: ['service'],
  registers: [register],
});
const poolIdle = new Gauge({
  name: 'db_pool_size_idle',
  help: 'Postgres pool idle clients',
  labelNames: ['service'],
  registers: [register],
});
const poolWaiting = new Gauge({
  name: 'db_pool_size_waiting',
  help: 'Postgres pool wait queue',
  labelNames: ['service'],
  registers: [register],
});
const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Cache hits',
  labelNames: ['cache', 'name', 'service'],
  registers: [register],
});
const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Cache misses',
  labelNames: ['cache', 'name', 'service'],
  registers: [register],
});
const cacheLatency = new Histogram({
  name: 'cache_operation_duration_seconds',
  help: 'Redis get/set latency',
  labelNames: ['op', 'name', 'service'],
  buckets: [0.0005, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});
const eventLoopDelay = new Histogram({
  name: 'node_event_loop_lag_seconds',
  help: 'Approximate event loop delay',
  labelNames: ['service'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});
const httpUpstreamDuration = new Histogram({
  name: 'http_outbound_request_duration_seconds',
  help: 'Outbound HTTP client (Axios) duration to upstreams',
  labelNames: ['target', 'status', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 15, 30, 60, 120, 300],
  registers: [register],
});
const httpUpstreamTimeout = new Counter({
  name: 'http_outbound_timeouts_total',
  help: 'Outbound HTTP request timeouts/abort',
  labelNames: ['target', 'service'],
  registers: [register],
});

function startEventLoopMonitoring() {
  if (!env.metricsEnabled) return;
}

if (env.metricsEnabled) {
  // Simple event-loop lag via setImmediate delta
  setInterval(() => {
    const t = performance.now();
    setImmediate(() => {
      const d = (performance.now() - t) / 1000;
      if (d < 0.001) return;
      eventLoopDelay.observe({ service: SERVICE }, d);
    });
  }, 2000);
}

function getMetricsRegister() {
  return register;
}

const redisInfoGauge = {
  used_memory_bytes: new Gauge({
    name: 'redis_used_memory_bytes',
    help: 'INFO used_memory (application-scoped ioredis connection estimate)',
    labelNames: ['service', 'url_hash'],
    registers: [register],
  }),
  ops_per_sec: new Gauge({
    name: 'redis_instantaneous_ops_per_sec',
    help: 'Redis instantaneous ops (from INFO)',
    labelNames: ['service', 'url_hash'],
    registers: [register],
  }),
  evicted_keys_total: new Counter({
    name: 'redis_evicted_keys_total',
    help: 'Cumulative evicted keys as reported by last INFO (delta approximated in scrape)',
    labelNames: ['service', 'url_hash'],
    registers: [register],
  }),
  connected_clients: new Gauge({
    name: 'redis_connected_clients',
    help: 'INFO connected_clients',
    labelNames: ['service', 'url_hash'],
    registers: [register],
  }),
};

const bullMetrics = {
  enqueued: new Counter({
    name: 'queue_jobs_enqueued_total',
    help: 'BullMQ jobs enqueued',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
  completed: new Counter({
    name: 'queue_jobs_completed_total',
    help: 'BullMQ jobs completed',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
  failed: new Counter({
    name: 'queue_jobs_failed_total',
    help: 'BullMQ jobs failed',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
  retried: new Counter({
    name: 'queue_jobs_retried_total',
    help: 'BullMQ jobs retried',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
  jobDuration: new Histogram({
    name: 'queue_job_duration_seconds',
    help: 'BullMQ job handler duration',
    labelNames: ['queue', 'service', 'name'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 14400, 28800, 72000, 100000, 200000, 1000000],
    registers: [register],
  }),
  backlog: new Gauge({
    name: 'queue_backlog',
    help: 'Jobs waiting+active+delayed',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
  workerConcurrency: new Gauge({
    name: 'queue_worker_concurrency',
    help: 'Configured worker concurrency per queue name',
    labelNames: ['queue', 'service', 'name'],
    registers: [register],
  }),
};

const appInfo = new Gauge({
  name: 'app_info',
  help: 'Build/version metadata (also used for deploy dashboards)',
  labelNames: ['version', 'service', 'migrations_status'],
  registers: [register],
});
appInfo.set(
  { version: env.appVersion, service: SERVICE, migrations_status: 'unknown' },
  1,
);

let _lastEvicted = {};

module.exports = {
  getMetricsRegister,
  SERVICE,
  startEventLoopMonitoring,
  httpInFlight,
  httpDuration,
  httpTotal,
  httpAuthFailures,
  httpRateLimitBlocks,
  dbQueries,
  dbDuration,
  requestDbQueryCount,
  poolTotal,
  poolIdle,
  poolWaiting,
  cacheHits,
  cacheMisses,
  cacheLatency,
  eventLoopDelay,
  httpUpstreamDuration,
  httpUpstreamTimeout,
  bullMetrics,
  appInfo,
  redisInfoGauge,
  register,
  /**
   * @param {import('ioredis').default} r
   * @param {string} urlHash
   */
  async updateRedisGauges(r, urlHash) {
    if (!env.metricsEnabled) return;
    if (!r || (typeof r.info !== 'function' && typeof r.info === 'undefined')) return;
    try {
      const infoStr = await r.info();
      if (typeof infoStr !== 'string') return;
      const m = (key) => {
        const line = infoStr
          .split('\r\n')
          .map((L) => L.split(':'))
          .find((pair) => pair[0] === key);
        if (!line || line[1] == null) return null;
        return Number(String(line[1].trim()).replace(/\D+$/g, ''));
      };
      const um = m('used_memory');
      if (um != null) {
        redisInfoGauge.used_memory_bytes.set({ service: SERVICE, url_hash: urlHash }, um);
      }
      const ops = m('instantaneous_ops_per_sec');
      if (ops != null) {
        redisInfoGauge.ops_per_sec.set({ service: SERVICE, url_hash: urlHash }, ops);
      }
      const cc = m('connected_clients');
      if (cc != null) {
        redisInfoGauge.connected_clients.set({ service: SERVICE, url_hash: urlHash }, cc);
      }
      const ev = m('evicted_keys');
      if (ev != null) {
        const key = `ev${urlHash}`;
        const last = _lastEvicted[key] || 0;
        if (ev > last) {
          redisInfoGauge.evicted_keys_total.inc({ service: SERVICE, url_hash: urlHash }, ev - last);
        }
        _lastEvicted[key] = ev;
      }
    } catch {
      /* ignore */
    }
  },
};
