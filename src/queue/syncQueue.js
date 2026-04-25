const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const env = require('../config/env');
const m = require('../metrics/prometheus');
const { SERVICE, bullMetrics } = m;

const QNAME = 'e2e-sync';
const JOB_NAME = 'e2e';

const ctx = { queue: QNAME, service: SERVICE, name: JOB_NAME };

const connection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
});

let queue;
/**
 * @returns {import('bullmq').Queue}
 */
function getQueue() {
  if (queue) return queue;
  queue = new Queue(QNAME, { connection, prefix: 'bull' });
  return queue;
}

let backfillStarted;
function startBacklogScrape() {
  if (backfillStarted) return;
  if (!env.useSyncQueue) return;
  backfillStarted = true;
  setInterval(async () => {
    try {
      const c = await getQueue().getJobCounts();
      const d = c.waiting + c.active + c.delayed;
      bullMetrics.backlog.set({ ...ctx }, d);
      bullMetrics.workerConcurrency.set({ ...ctx }, env.bull.syncConcurrency);
    } catch {
      /* */
    }
  }, 5_000);
}

/**
 * @param {{ userId: string, syncId: string, appointmentDate: string }} data
 */
async function enqueueE2eSync(data) {
  startBacklogScrape();
  const job = await getQueue().add(
    JOB_NAME,
    { userId: data.userId, syncId: data.syncId, appointmentDate: data.appointmentDate },
    {
      jobId: `sync-${data.syncId}`,
      delay: 0,
      removeOnComplete: 50,
      removeOnFail: 20,
      attempts: Number(process.env.BULL_ATTEMPTS || 1),
      backoff: { type: 'exponential', delay: 120_000 },
    },
  );
  bullMetrics.enqueued.inc({ ...ctx });
  return job;
}

/**
 * @param {(b: { connection: IORedis }) => void} registerEvents
 * @param {{ runEndToEndSync: function, markSyncFailed: function, fetchCredentialsForE2E: function }} deps
 */
function createWorker(deps) {
  const { runEndToEndSync, markSyncFailed, fetchCredentialsForE2E } = deps;
  startBacklogScrape();

  const w = new Worker(
    QNAME,
    async (job) => {
      const t0 = process.hrtime.bigint();
      const { userId, syncId, appointmentDate } = job.data;
      const creds = await fetchCredentialsForE2E(userId);
      try {
        await runEndToEndSync({
          userId,
          syncId,
          appointmentDate,
          officeAllyCreds: creds.officeAllyCreds,
          availityCreds: creds.availityCreds,
        });
      } finally {
        const sec = Number(process.hrtime.bigint() - t0) / 1e9;
        bullMetrics.jobDuration.observe({ ...ctx }, sec);
      }
    },
    {
      connection: new IORedis(env.redisUrl, { maxRetriesPerRequest: null }),
      prefix: 'bull',
      concurrency: env.bull.syncConcurrency,
      lockDuration: Number(process.env.BULL_LOCK_DURATION_MS || 3_600_000),
    },
  );
  w.on('completed', () => {
    bullMetrics.completed.inc({ ...ctx });
  });
  w.on('failed', async (job, err) => {
    if (!job) return;
    bullMetrics.failed.inc({ ...ctx });
    const max = (job.opts && job.opts.attempts) || 1;
    const started = job.attemptsStarted != null ? job.attemptsStarted : 1;
    if (started >= max) {
      await markSyncFailed(job.data.syncId, err);
    }
  });
  w.on('stalled', () => {
    bullMetrics.retried.inc({ ...ctx });
  });

  return { worker: w, close: () => w.close() };
}

async function close() {
  if (queue) {
    await queue.close();
  }
  await connection.quit();
}

module.exports = {
  enqueueE2eSync,
  getQueue,
  startBacklogScrape,
  createWorker,
  close,
  QNAME,
  connection,
};
