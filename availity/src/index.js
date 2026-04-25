import path from 'path';
import { fileURLToPath } from 'url';
import { loadAvailityConfig, assertAvailityEnv } from './config.js';
import { createLogger } from './logger.js';
import { createDatabase } from './db.js';
import { createBrowser } from './browser.js';
import { runAvailityEligibility } from './runEligibility.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadAvailityConfig();
  assertAvailityEnv(config);

  const logFile =
    process.env.AVAILITY_LOG_FILE || path.join(__dirname, '../logs/availity-eligibility.log');
  const logger = createLogger({ logFile });
  logger.info('Availity eligibility (function-based: availity/src)');

  const db = createDatabase(config.pg);
  const browser = createBrowser(config, logger);

  try {
    const summary = await runAvailityEligibility({ config, logger, browser, db });
    logger.info(
      `Done: processed=${summary.processed} success=${summary.successes} failed=${summary.failures}`,
    );
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
