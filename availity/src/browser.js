import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

/** @param {ReturnType<import('./config.js').loadAvailityConfig>} config */
export function createBrowser(config, logger) {
  let browser = null;
  let context = null;
  /** @type {import('playwright').Page | null} */
  let page = null;

  return {
    get page() {
      return page;
    },
    setPage(nextPage) {
      if (nextPage) page = nextPage;
    },
    async launch() {
      logger.step('Launch browser', `headless=${config.headless}`);
      browser = await chromium.launch({
        headless: config.headless,
        slowMo: config.slowMoMs || undefined,
      });
      const ctxOpts = {
        viewport: { width: 1400, height: 900 },
        acceptDownloads: true,
      };
      const statePath = config.availity?.storageStatePath;
      if (statePath && fs.existsSync(statePath)) {
        ctxOpts.storageState = statePath;
        logger.info(`Restoring Availity session from ${statePath}`);
      }
      context = await browser.newContext(ctxOpts);
      page = await context.newPage();
      page.on('console', (msg) => {
        if (process.env.DEBUG_BROWSER === '1') {
          logger.info(`[browser console] ${msg.type()}: ${msg.text()}`);
        }
      });
      return page;
    },
    async screenshot(name) {
      if (!page) return;
      const dir = config.screenshotDir;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      logger.info(`Screenshot: ${file}`);
    },
    async saveStorageState() {
      const statePath = config.availity?.storageStatePath;
      if (!statePath || !context) return;
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      await context.storageState({ path: statePath });
      logger.info(`Saved Availity session to ${statePath}`);
    },
    async close() {
      if (browser) await browser.close();
      browser = null;
      context = null;
      page = null;
    },
  };
}
