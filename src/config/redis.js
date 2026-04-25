const env = require('./env');
const crypto = require('node:crypto');
const m = require('../metrics/prometheus');

if (process.env.NODE_ENV === 'test') {
  const store = new Map();
  module.exports = {
    get: async (k) => (store.get(k) != null ? String(store.get(k)) : null),
    set: async (k, v, ..._rest) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k) => {
      const had = store.has(k);
      store.delete(k);
      return had ? 1 : 0;
    },
    status: 'ready',
    info: async () => '',
  };
} else {
  const Redis = require('ioredis');
  const redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 3,
  });

  const urlHash = crypto
    .createHash('md5')
    .update(env.redisUrl)
    .digest('hex')
    .slice(0, 8);

  if (env.metricsEnabled) {
    setInterval(() => {
      m.updateRedisGauges(redis, urlHash);
    }, 10_000);
  }

  module.exports = redis;
}
