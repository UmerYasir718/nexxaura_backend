require('../instrument');
const http = require('node:http');
const env = require('./config/env');
const m = require('./metrics/prometheus');
const { createWorker } = require('./queue/syncQueue');
const { runEndToEndSync } = require('./services/pipelineService');
const { fetchCredentialsForE2E, markSyncFailed } = require('./services/syncService');

m.startEventLoopMonitoring();

if (!env.useSyncQueue) {
  // eslint-disable-next-line no-console
  console.error('Set USE_SYNC_QUEUE=1 to run the BullMQ worker (Redis required).');
  process.exit(1);
}

createWorker({ runEndToEndSync, markSyncFailed, fetchCredentialsForE2E });

const server = http.createServer(async (req, res) => {
  const u = req.url ? req.url.split('?')[0] : '/';
  if (u === '/health') {
    res.setHeader('content-type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ status: 'ok', role: 'e2e-sync-worker' }));
  }
  if (u === '/metrics' && env.metricsEnabled) {
    res.setHeader('content-type', m.getMetricsRegister().contentType);
    return res.end(await m.getMetricsRegister().metrics());
  }
  if (u === '/metrics' && !env.metricsEnabled) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(404);
  return res.end();
});

const port = env.workerMetricsPort;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`E2E sync worker: BullMQ consumer running. Metrics/health on port ${port}.`);
});
