require('../instrument');
const app = require('./app');
const env = require('./config/env');
const m = require('./metrics/prometheus');

m.startEventLoopMonitoring();

if (env.useSyncQueue) {
  const { startBacklogScrape } = require('./queue/syncQueue');
  startBacklogScrape();
}

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${env.port}`);
});
