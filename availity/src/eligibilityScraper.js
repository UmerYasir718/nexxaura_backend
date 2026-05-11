/**
 * Availity eligibility — function API. ctx = { config, logger, browser }.
 * config matches loadAvailityConfig() (includes nested config.availity).
 */

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatUsDateFromIso(isoDate) {
  if (isoDate == null || isoDate === '') return '';
  if (isoDate instanceof Date) {
    if (Number.isNaN(isoDate.getTime())) return '';
    // Use UTC components so date-only DB values never shift by local timezone.
    const m = String(isoDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(isoDate.getUTCDate()).padStart(2, '0');
    const y = isoDate.getUTCFullYear();
    return `${m}/${day}/${y}`;
  }

  const s = String(isoDate).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;

  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

function todayUsDate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

function yesterdayUsDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function tryClickCookieConsent(page, logger) {
  const candidates = [
    '#accept-recommended-btn-handler',
    '#onetrust-accept-btn-handler',
    'button:has-text("Allow All Cookies")',
    'button:has-text("Accept All Cookies")',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loc.click({ timeout: 5000 });
        logger?.info?.(`Cookie consent: clicked ${sel}`);
        await sleep(500);
        return;
      }
    } catch {
      /* continue */
    }
  }
}

async function firstVisibleFill(page, selectors, value, logger) {
  const list = String(selectors)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of list) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
        await loc.fill(value, { timeout: 20000 });
        logger?.info?.(`Filled ${sel}`);
        return;
      }
    } catch {
      /* next */
    }
  }
  throw new Error(`Availity login: no visible user field for: ${list.join(' | ')}`);
}

async function hasVisibleSelector(page, selectors, timeoutMs = 1200) {
  const list = String(selectors)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of list) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false)) return true;
  }
  return false;
}

async function waitForAnyVisibleSelector(page, selectors, timeoutMs = 45000) {
  const list = String(selectors)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of list) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) return sel;
    }
    await sleep(400);
  }
  return null;
}

async function firstVisibleClick(page, selectors, logger) {
  const list = String(selectors)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of list) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
        await loc.click({ timeout: 20000 });
        logger?.info?.(`Clicked ${sel}`);
        return;
      }
    } catch {
      /* next */
    }
  }
  throw new Error(`Availity login: no visible submit for: ${list.join(' | ')}`);
}

async function ensureAvailityLoginFormVisible(page, userSelectors, logger, loginUrl) {
  if (await hasVisibleSelector(page, userSelectors, 1800)) return;
  await tryClickCookieConsent(page, logger);

  const starters = [
    'button:has-text("Sign In")',
    'a:has-text("Sign In")',
    'button:has-text("Log In")',
    'a:has-text("Log In")',
    'a[href*="#/login"]',
  ];

  for (const sel of starters) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible({ timeout: 1200 }).catch(() => false))) continue;
    await loc.click({ timeout: 10000 }).catch(() => {});
    logger?.info?.(`Login pre-step clicked: ${sel}`);
    await sleep(1200);
    if (await hasVisibleSelector(page, userSelectors, 1500)) return;
  }

  const fallbackLoginUrl = /#\/login/i.test(String(loginUrl || ''))
    ? loginUrl
    : `${String(loginUrl || '').replace(/\/+$/, '')}/#/login`;
  if (fallbackLoginUrl) {
    await page.goto(fallbackLoginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
    await sleep(900);
  }
}

/** True when MFA challenge UI is likely showing (OTP entry, etc.). */
async function pageLooksLikeMfaChallenge(page) {
  const url = page.url();
  if (/mfa|multi-?factor|verify|challenge|authenticat|duo|okta/i.test(url)) return true;
  if (await page.locator('#2fa-totp-input-token-page-content-grid').first().isVisible({ timeout: 400 }).catch(() => false)) {
    return true;
  }
  const otpish = page.locator(
    'input#code,input[inputmode="numeric"],input[name="otp"],input[name="code"],input[autocomplete="one-time-code"],input[aria-label*="code" i],input[placeholder*="code" i]',
  );
  const n = await otpish.count().catch(() => 0);
  if (n > 0) {
    const first = otpish.first();
    if (await first.isVisible().catch(() => false)) return true;
  }
  return false;
}

/** True when login + MFA appear complete enough for the rest of the script. */
async function pageLooksLikePostMfaSession(page, contentFrameSel) {
  const url = page.url();
  if (!/availity\.com/i.test(url)) return false;

  if (await pageLooksLikeMfaChallenge(page)) return false;

  const methodRadio = page.getByRole('radio', { name: /Authenticator app|authenticator|phone|email|text message/i }).first();
  if (await methodRadio.isVisible({ timeout: 400 }).catch(() => false)) return false;

  if (/loadApp.*eligibility/i.test(url) || /appUrl=.*eligibility/i.test(url)) return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation/i.test(url)) return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation\/#\/?$/i.test(url)) return true;

  const frameSel = String(contentFrameSel || 'iframe#newBodyFrame');
  const frame = page.locator(frameSel).first();
  if (await frame.isVisible({ timeout: 600 }).catch(() => false)) {
    const handle = await frame.elementHandle().catch(() => null);
    if (handle) {
      const fr = await handle.contentFrame().catch(() => null);
      await handle.dispose().catch(() => {});
      if (fr) {
        const org = fr.locator('#organization-field').first();
        if (await org.isVisible({ timeout: 800 }).catch(() => false)) return true;
      }
    }
  }

  const userField = page.locator('input#userId,input[name="userId"]').first();
  const passField = page.locator('input#password,input[name="password"][type="password"]').first();
  if (
    /#\/login\b/i.test(url) &&
    (await userField.isVisible({ timeout: 400 }).catch(() => false)) &&
    (await passField.isVisible({ timeout: 400 }).catch(() => false))
  ) {
    return false;
  }

  return false;
}

/**
 * After username/password: select Authenticator app MFA method, Continue, then wait for manual OTP success.
 * @param {import('playwright').Page} page
 * @param {object} logger
 * @param {object} av — `config.availity` from loadAvailityConfig()
 */
async function availityPostLoginMfaFlow(page, logger, av) {
  const methodPhrase = String(av.mfaAuthenticatorMethodText || 'Authenticator app').trim();
  const methodRe = new RegExp(escapeRe(methodPhrase), 'i');
  const shortRe = /Authenticator app/i;
  const rawTimeout = Number(av.mfaWaitTimeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) ? rawTimeout : 0;
  const waitForever = timeoutMs <= 0;

  await sleep(2000);
  await tryClickCookieConsent(page, logger);

  let selectedMethod = false;
  const radio = page.getByRole('radio', { name: methodRe }).first();
  if (await radio.isVisible({ timeout: 6000 }).catch(() => false)) {
    await radio.click({ timeout: 15000 });
    selectedMethod = true;
    logger?.info?.('MFA: selected Authenticator app (radio)');
  }
  if (!selectedMethod) {
    const radio2 = page.getByRole('radio', { name: shortRe }).first();
    if (await radio2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radio2.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.('MFA: selected Authenticator app (radio, short match)');
    }
  }
  if (!selectedMethod) {
    const label = page.locator('label').filter({ hasText: methodRe }).first();
    if (await label.isVisible({ timeout: 4000 }).catch(() => false)) {
      await label.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.('MFA: clicked Authenticator method label');
    }
  }
  if (!selectedMethod) {
    const row = page.getByText(methodRe, { exact: false }).first();
    if (await row.isVisible({ timeout: 4000 }).catch(() => false)) {
      await row.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.('MFA: clicked Authenticator method text');
    }
  }
  if (!selectedMethod) {
    const domRadio = page.locator('input[type="radio"][name="choice"][value*="Authenticator"]').first();
    if (await domRadio.isVisible({ timeout: 4000 }).catch(() => false)) {
      await domRadio.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.('MFA: selected Authenticator (input[name=choice] per Availity FR UI)');
    }
  }

  if (selectedMethod) {
    const continueBtn = page.getByRole('button', { name: /^(Continue|Next)$/i }).first();
    if (await continueBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await continueBtn.click({ timeout: 20000 });
      logger?.info?.('MFA: clicked Continue after method selection');
    } else {
      const alt = page.locator('button:has-text("Continue"),input[type="submit"][value*="Continue" i]').first();
      if (await alt.isVisible({ timeout: 4000 }).catch(() => false)) {
        await alt.click({ timeout: 20000 });
        logger?.info?.('MFA: clicked Continue (fallback selector)');
      }
    }
    await sleep(1500);
  } else {
    if (await pageLooksLikeMfaChallenge(page)) {
      logger?.info?.('MFA: challenge visible without method step — waiting for code entry');
    } else {
      logger?.info?.('MFA: authenticator method UI not found — assuming no MFA or already past');
      if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) return;
    }
  }

  const startedAt = Date.now();
  let lastStepLog = 0;
  while (true) {
    if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
      logger?.step?.('MFA', 'Authenticator flow complete');
      await tryClickCookieConsent(page, logger);
      return;
    }
    if (Date.now() - lastStepLog > 30_000) {
      logger?.step?.(
        'MFA',
        'Waiting for authenticator code — enter it in the browser, then wait for success',
      );
      lastStepLog = Date.now();
    }
    if (!waitForever && Date.now() - startedAt >= timeoutMs) break;
    await sleep(2000);
  }

  throw new Error(
    `Availity MFA: timed out after ${timeoutMs}ms. Enter the code in the browser or increase AVAILITY_MFA_WAIT_MS.`,
  );
}

async function pickAutocompleteOption(frame, inputCss, query, optionNameRe, logger) {
  const box = frame.locator(inputCss).first();
  await box.click({ timeout: 20000 });
  await box.fill('');
  await box.fill(query);
  await sleep(600);
  const listbox = frame.getByRole('listbox');
  await listbox.waitFor({ state: 'visible', timeout: 25000 });
  const opt = frame.getByRole('option', { name: optionNameRe }).first();
  await opt.click({ timeout: 20000 });
  logger?.info?.(`Autocomplete ${inputCss} → picked option matching ${optionNameRe}`);
  await sleep(400);
}

async function pickAutocompleteOptionFirstMatch(frame, inputCss, query, logger) {
  const box = frame.locator(inputCss).first();
  await box.click({ timeout: 20000 });
  await box.fill('');
  await box.fill(query);
  await sleep(800);
  const listbox = frame.getByRole('listbox');
  await listbox.waitFor({ state: 'visible', timeout: 25000 });
  const opt = frame.locator('[role="option"]').first();
  await opt.click({ timeout: 20000 });
  logger?.info?.(`Autocomplete ${inputCss} → first option`);
  await sleep(400);
}

async function fillMuiMultiSectionDate(frame, ariaLabelledById, usDate, logger) {
  const group = frame.locator(`div[role="group"][aria-labelledby="${ariaLabelledById}"]`).first();
  await group.waitFor({ state: 'visible', timeout: 30000 });
  await group.locator('.MuiPickersSectionList-root').click({ timeout: 10000 });
  await sleep(200);
  const pg = frame.page();
  await pg.keyboard.press('Control+a');
  await pg.keyboard.type(usDate, { delay: 35 });
  logger?.info?.(`Set date (${ariaLabelledById}): ${usDate}`);
  await sleep(300);
}

async function safeOptionalAutocomplete(frame, inputCss, query, optionRe, logger, label) {
  try {
    const box = frame.locator(inputCss).first();
    if (!(await box.isVisible({ timeout: 2000 }).catch(() => false))) return;
    const cur = await box.inputValue().catch(() => '');
    if (cur && cur.trim()) {
      logger?.info?.(`${label} already filled, skipping`);
      return;
    }
    await pickAutocompleteOption(frame, inputCss, query, optionRe, logger);
  } catch (e) {
    logger?.warn?.(`${label} optional fill failed: ${e.message || e}`);
  }
}

export async function availityGetContentFrame(ctx) {
  const sel = ctx.config.availity.contentFrameSelector;
  const page = ctx.browser.page;
  const handle = await page.locator(sel).first().elementHandle({ timeout: 120000 });
  if (!handle) throw new Error(`Availity: iframe not found: ${sel}`);
  const fr = await handle.contentFrame();
  await handle.dispose();
  if (!fr) throw new Error(`Availity: no contentDocument for ${sel}`);
  return fr;
}

export async function availityLogin(ctx) {
  const { loginUrl, username, password } = ctx.config.availity;
  const page = ctx.browser.page;
  ctx.logger.step('Availity login', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tryClickCookieConsent(page, ctx.logger);
  await sleep(800);

  // Storage-state sessions may open directly into the navigation shell/dashboard.
  // In that case, there is no login form and we should skip credential submission.
  if (await pageLooksLikePostMfaSession(page, ctx.config.availity.contentFrameSelector)) {
    ctx.logger.info('Availity session already authenticated; skipping login form');
    await tryClickCookieConsent(page, ctx.logger);
    await ctx.browser.saveStorageState?.();
    return;
  }

  const userSelectors =
    process.env.SEL_AVAILITY_USER ||
    'input[name="username"],input#username,input#userId,input[name="userId"],input[autocomplete="username"]';
  const passSelectors =
    process.env.SEL_AVAILITY_PASS ||
    'input[name="password"],input#password,input[type="password"],input[autocomplete="current-password"]';
  const submitSelectors =
    process.env.SEL_AVAILITY_SUBMIT ||
    'button[type="submit"],button:has-text("Sign In"),button:has-text("Log In"),button:has-text("Login")';

  await ensureAvailityLoginFormVisible(page, userSelectors, ctx.logger, loginUrl);

  // Re-check after pre-login helpers because a valid session can still redirect
  // into navigation while we were trying login-entry steps.
  if (await pageLooksLikePostMfaSession(page, ctx.config.availity.contentFrameSelector)) {
    ctx.logger.info('Availity session became authenticated during login pre-check; skipping credentials');
    await tryClickCookieConsent(page, ctx.logger);
    await ctx.browser.saveStorageState?.();
    return;
  }

  const visibleUserSel = await waitForAnyVisibleSelector(page, userSelectors, 45000);
  if (!visibleUserSel) {
    // Saved session can place us on the dashboard shell URL (navigation/#/) with no login fields.
    // Treat this as authenticated and allow the next step to open Eligibility directly.
    if (await pageLooksLikePostMfaSession(page, ctx.config.availity.contentFrameSelector)) {
      ctx.logger.warn(
        `Login form not visible, but dashboard session detected at ${page.url()}; skipping form login`,
      );
      await tryClickCookieConsent(page, ctx.logger);
      await ctx.browser.saveStorageState?.();
      return;
    }

    const compactParts = [];
    for (const s of userSelectors.split(',').map((x) => x.trim()).filter(Boolean)) {
      const c = await page.locator(s).count().catch(() => 0);
      compactParts.push(`${s} count=${c}`);
    }
    const compact = compactParts.join(' | ');
    throw new Error(`Availity login: user input not visible after wait. URL=${page.url()} selectors=${compact}`);
  }
  ctx.logger.info(`Login user field ready: ${visibleUserSel}`);
  await firstVisibleFill(page, userSelectors, username, ctx.logger);
  await firstVisibleFill(page, passSelectors, password, ctx.logger);
  await firstVisibleClick(page, submitSelectors, ctx.logger);

  await page.waitForURL(/availity\.com/i, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await tryClickCookieConsent(page, ctx.logger);

  await availityPostLoginMfaFlow(page, ctx.logger, ctx.config.availity);
  await sleep(1500);
  await tryClickCookieConsent(page, ctx.logger);
  await ctx.browser.saveStorageState?.();
}

/**
 * After an inquiry, the shell URL often stays the same while the iframe still shows
 * #patient-card (results). Polling for #organization-field then burns the full timeout.
 * @param {import('playwright').Page} page
 * @param {string} frameSel
 */
async function eligibilityIframeShowsResultsWithoutForm(page, frameSel) {
  const frameLoc = page.locator(frameSel).first();
  if (!(await frameLoc.isVisible({ timeout: 2500 }).catch(() => false))) return false;
  const handle = await frameLoc.elementHandle().catch(() => null);
  if (!handle) return false;
  const fr = await handle.contentFrame().catch(() => null);
  await handle.dispose().catch(() => {});
  if (!fr) return false;
  const hasCard = await fr.locator('#patient-card').first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!hasCard) return false;
  const orgVisible = await fr.locator('#organization-field').first().isVisible({ timeout: 1500 }).catch(() => false);
  return !orgVisible;
}

/**
 * Wait for the eligibility app iframe and #organization-field (slow shell → embed).
 * @param {import('playwright').Page} page
 * @param {string} frameSel
 * @param {number} maxWaitMs
 */
async function pollEligibilityFormVisible(page, frameSel, maxWaitMs) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const frameLoc = page.locator(frameSel).first();
    if (!(await frameLoc.isVisible({ timeout: 3500 }).catch(() => false))) {
      await sleep(750);
      continue;
    }
    const handle = await frameLoc.elementHandle().catch(() => null);
    if (!handle) {
      await sleep(750);
      continue;
    }
    const fr = await handle.contentFrame().catch(() => null);
    await handle.dispose().catch(() => {});
    if (!fr) {
      await sleep(750);
      continue;
    }
    if (await fr.locator('#organization-field').first().isVisible({ timeout: 6000 }).catch(() => false)) {
      return true;
    }
    await sleep(750);
  }
  return false;
}

/**
 * @param {{ config: any, logger: any, browser: any }} ctx
 * @param {{
 *   embedMaxWaitMs?: number,
 *   embedAfterDirectMaxWaitMs?: number,
 *   assignPollMs?: number,
 * } | undefined} [opts]
 */
export async function availityOpenEligibilityApp(ctx, opts = {}) {
  const page = ctx.browser.page;
  const configuredUrl = ctx.config.availity.eligibilityAppUrl;
  const frameSel = ctx.config.availity.contentFrameSelector || 'iframe#newBodyFrame';
  const eligibilityPathRe = /\/static\/web\/pres\/web\/eligibility\/?/i;
  const eligibilityShellRe = /appUrl=.*eligibility/i;
  const loaderEligibilityUrl =
    'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpres%2Fweb%2Feligibility%2F';
  const directEligibilityUrl = 'https://essentials.availity.com/static/web/pres/web/eligibility/';
  const openUrl =
    eligibilityPathRe.test(String(configuredUrl || '')) || eligibilityShellRe.test(String(configuredUrl || ''))
      ? configuredUrl
      : loaderEligibilityUrl;
  const embedMaxWaitMs = opts.embedMaxWaitMs ?? 120_000;
  const embedAfterDirectMaxWaitMs = opts.embedAfterDirectMaxWaitMs ?? 90_000;
  const assignPollMs = opts.assignPollMs ?? 60_000;
  ctx.logger.step('Open eligibility app', openUrl);

  /** @param {string} target */
  const navigateAndSettle = async (target) => {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await sleep(1000);
  };

  const resetIfStuckOnResults = async (where) => {
    if (!(await eligibilityIframeShowsResultsWithoutForm(page, frameSel))) return;
    ctx.logger.warn(
      `[eligibility] inquiry results still in iframe (${where}); reloading top page so the form can load`,
    );
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await sleep(800);
  };

  await resetIfStuckOnResults('before navigation');
  await navigateAndSettle(openUrl);
  await resetIfStuckOnResults('after navigation');

  const looksLikeEligibilityUrl = (u) => eligibilityPathRe.test(u) || eligibilityShellRe.test(u);
  const onDirectEligibilityDocument = (u) => eligibilityPathRe.test(u) && !eligibilityShellRe.test(u);

  const isEligibilityFrameReady = async () => {
    const frameLoc = page.locator(frameSel).first();
    if (!(await frameLoc.isVisible({ timeout: 8000 }).catch(() => false))) return false;
    const handle = await frameLoc.elementHandle().catch(() => null);
    if (!handle) return false;
    const fr = await handle.contentFrame().catch(() => null);
    await handle.dispose().catch(() => {});
    if (!fr) return false;
    return fr
      .locator('#organization-field')
      .first()
      .isVisible({ timeout: 8000 })
      .catch(() => false);
  };

  const waitMsInitial = embedMaxWaitMs;
  const waitMsAfterDirect = embedAfterDirectMaxWaitMs;

  if (looksLikeEligibilityUrl(page.url())) {
    ctx.logger.info(
      `[eligibility] waiting on page for embed + organization field (up to ${Math.round(waitMsInitial / 1000)}s)…`,
    );
    let ok = await pollEligibilityFormVisible(page, frameSel, waitMsInitial);
    if (ok) {
      ctx.logger.info('[eligibility] eligibility form ready');
    } else if (!onDirectEligibilityDocument(page.url())) {
      ctx.logger.warn(
        `[eligibility] form not ready after ${Math.round(waitMsInitial / 1000)}s; navigating to direct eligibility URL`,
      );
      await navigateAndSettle(directEligibilityUrl);
      await resetIfStuckOnResults('after direct URL navigation');
      ctx.logger.info(
        `[eligibility] waiting for form after direct URL (up to ${Math.round(waitMsAfterDirect / 1000)}s)…`,
      );
      ok = await pollEligibilityFormVisible(page, frameSel, waitMsAfterDirect);
      if (ok) ctx.logger.info('[eligibility] eligibility form ready after direct URL');
    } else {
      ctx.logger.warn(
        `[eligibility] form not ready after ${Math.round(waitMsInitial / 1000)}s on direct eligibility URL`,
      );
    }
  } else {
    ctx.logger.warn(`[eligibility] unexpected URL after open (${page.url()}); navigating loader URL`);
    await navigateAndSettle(loaderEligibilityUrl);
    await resetIfStuckOnResults('after loader URL navigation');
    await pollEligibilityFormVisible(page, frameSel, waitMsInitial);
  }

  if (!(looksLikeEligibilityUrl(page.url()) && (await isEligibilityFrameReady()))) {
    ctx.logger.warn(`[eligibility] form still not ready (${page.url()}); forcing location.assign to loader`);
    await page.evaluate((u) => window.location.assign(u), loaderEligibilityUrl).catch(() => {});
    await sleep(1500);
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await pollEligibilityFormVisible(page, frameSel, assignPollMs);
  }

  if (!(looksLikeEligibilityUrl(page.url()) && (await isEligibilityFrameReady()))) {
    ctx.logger.warn(`[eligibility] form still not ready (${page.url()}); forcing location.assign to direct`);
    await page.evaluate((u) => window.location.assign(u), directEligibilityUrl).catch(() => {});
    await sleep(1500);
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await pollEligibilityFormVisible(page, frameSel, assignPollMs);
  }

  if (!(await isEligibilityFrameReady())) {
    ctx.logger.info('[eligibility] waiting for eligibility frame/form to become ready');
    await page.locator(frameSel).first().waitFor({ state: 'visible', timeout: 120000 });
    const frame = await availityGetContentFrame(ctx);
    await frame.locator('#organization-field').first().waitFor({ state: 'visible', timeout: 120000 });
  } else {
    await page.locator(frameSel).first().waitFor({ state: 'visible', timeout: 120000 });
  }

  await tryClickCookieConsent(page, ctx.logger);
  await sleep(800);
}

export async function availityFillInquiryForm(ctx, frame, patient) {
  const av = ctx.config.availity;
  const logger = ctx.logger;
  const payerRe = new RegExp(escapeRe(patient.payerName.trim()), 'i');

  await pickAutocompleteOption(
    frame,
    '#organization-field',
    av.organizationQuery,
    new RegExp(av.organizationOptionRegex, 'i'),
    logger,
  );

  try {
    await pickAutocompleteOption(frame, '#payerId-field', patient.payerName.trim(), payerRe, logger);
  } catch (e) {
    logger.warn(`Payer strict match failed, trying first list match… (${e.message || e})`);
    await pickAutocompleteOptionFirstMatch(frame, '#payerId-field', patient.payerName.trim().slice(0, 12), logger);
  }

  const provRe = new RegExp(av.providerOptionRegex, 'i');
  try {
    await pickAutocompleteOption(frame, '#provider', av.providerQuery, provRe, logger);
  } catch (e) {
    logger.warn(`Provider regex match failed, trying NPI only… (${e.message || e})`);
    await pickAutocompleteOption(frame, '#provider', '1093454423', /1093454423/, logger);
  }

  await safeOptionalAutocomplete(
    frame,
    '#patientSearchOption',
    av.patientSearchOptionQuery,
    new RegExp(escapeRe(av.patientSearchOptionQuery), 'i'),
    logger,
    'Patient search option',
  );

  await safeOptionalAutocomplete(
    frame,
    '#subscriberRelationship-field',
    av.subscriberRelationshipQuery,
    new RegExp(escapeRe(av.subscriberRelationshipQuery), 'i'),
    logger,
    'Subscriber relationship',
  );

  const memberInput = frame.locator('input[name="memberId"]').first();
  await memberInput.fill(patient.memberId.trim(), { timeout: 20000 });

  const dobUs = formatUsDateFromIso(patient.patientDobIso);
  if (!dobUs) throw new Error('Patient DOB missing or invalid');
  await fillMuiMultiSectionDate(frame, 'patientBirthDatefield-picker-label', dobUs, logger);

  await fillMuiMultiSectionDate(frame, 'asOfDate-picker-label', yesterdayUsDate(), logger);

  const svcRe = new RegExp(av.benefitServiceTypeOptionRe, 'i');
  await pickAutocompleteOption(frame, '#serviceType', av.benefitServiceTypeQuery, svcRe, logger);
}

export async function availitySubmitInquiry(ctx, frame) {
  await frame.getByRole('button', { name: /^submit$/i }).click({ timeout: 30000 });
  ctx.logger.info('Submitted eligibility inquiry');
}

export async function availityWaitForResponse(ctx, frame) {
  const memberLine = frame.locator('.patient-card-extended-label', { hasText: /member id/i });
  const chip = frame.getByText(/active coverage|inactive|not eligible/i);
  const err = frame.locator('.MuiAlert-message');
  await Promise.race([
    memberLine.first().waitFor({ state: 'visible', timeout: 180000 }),
    chip.first().waitFor({ state: 'visible', timeout: 180000 }),
    err.first().waitFor({ state: 'visible', timeout: 180000 }),
  ]);
  await availityWaitForResultDetailDom(frame);
}

/**
 * After chip/member line appears, summary blocks can paint a beat later. Avoid parsing
 * when #patient-card / plan summary are still missing (wrong fallbacks).
 * @param {import('playwright').Frame} frame
 */
export async function availityWaitForResultDetailDom(frame) {
  const alertVis = await frame.locator('.MuiAlert-message').first().isVisible({ timeout: 1500 }).catch(() => false);
  if (alertVis) {
    await sleep(200);
    return;
  }
  const t = 15000;
  await Promise.race([
    frame.locator('#patient-card').waitFor({ state: 'visible', timeout: t }),
    frame.locator('#plan-details-summary').waitFor({ state: 'visible', timeout: t }),
    frame.locator('.patient-card-extended-label', { hasText: /member id/i }).first().waitFor({ state: 'visible', timeout: t }),
  ]).catch(() => {});
  await sleep(500);
}

export async function availityParseResponseSnapshot(frame) {
  return frame.evaluate(() => {
    /** @type {Record<string, string>} */
    const labels = {};
    const card = document.querySelector('#patient-card');

    const mergeLabel = (k, v) => {
      if (!k || v == null || String(v).trim() === '') return;
      const key = String(k).replace(/:\s*$/, '').trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(labels, key)) return;
      labels[key] = String(v).trim();
    };

    const planList = document.querySelector('#plan-details-summary');
    if (planList) {
      planList.querySelectorAll('li').forEach((li) => {
        const left = li.querySelector('span.text-left');
        const right = li.querySelector('span.text-right');
        if (!left || !right) return;
        const strong = left.querySelector('strong');
        if (!strong) return;
        const k = strong.innerText.replace(/:\s*$/, '').trim();
        const rightStrong = right.querySelector('strong');
        const v = (rightStrong || right).innerText.trim();
        if (k) labels[k] = v;
      });
    }

    const extRoot = card || document.body;
    extRoot.querySelectorAll('.patient-card-extended-label').forEach((el) => {
      const sp = el.querySelector('span');
      const sm = el.querySelector('small');
      if (!sp || !sm) return;
      const k = sp.innerText.replace(/:\s*$/, '').trim();
      const v = sm.innerText.trim();
      if (k) mergeLabel(k, v);
    });

    if (card) {
      const pickAdjacentSmall = (re) => {
        const nodes = [...card.querySelectorAll('small')];
        const idx = nodes.findIndex((s) => re.test(s.innerText));
        if (idx === -1) return;
        const label = nodes[idx].innerText.replace(/:\s*$/, '').trim();
        const next = nodes[idx].nextElementSibling;
        if (next && next.tagName === 'SMALL') mergeLabel(label, next.innerText.trim());
      };
      pickAdjacentSmall(/date of service/i);
      pickAdjacentSmall(/transaction id/i);
      pickAdjacentSmall(/transaction time/i);
      pickAdjacentSmall(/customer id/i);
    }

    const txSpan = [...document.querySelectorAll('span')].find((s) =>
      /transaction date/i.test(s.innerText),
    );
    let transactionDate = '';
    if (txSpan) {
      const sib = txSpan.nextElementSibling;
      if (sib && sib.tagName === 'SMALL') transactionDate = sib.innerText.trim();
    }
    if (transactionDate && !labels['Transaction Date']) labels['Transaction Date'] = transactionDate;

    let chipText = '';
    if (card) {
      const scoped =
        card.querySelector('#patient-summary .MuiChip-label') || card.querySelector('.MuiChip-label');
      chipText = scoped ? scoped.innerText.trim() : '';
    }
    if (!chipText) {
      const chip = document.querySelector('.MuiChip-label');
      chipText = chip ? chip.innerText.trim() : '';
    }

    const planScope =
      card?.closest('header')?.parentElement || document.querySelector('main') || document.body;
    const ps = [...planScope.querySelectorAll('p')];
    const spanAfter = (p) => {
      const span = p && p.querySelector('span');
      return span ? span.innerText.trim() : '';
    };
    const planP = ps.find((p) => /\bPlan\s*\/\s*Product\b/i.test(p.innerText));
    let planProduct = spanAfter(planP);
    const insP = ps.find((p) => /\bInsurance Type\b/i.test(p.innerText));
    let insuranceType = spanAfter(insP);
    const levP = ps.find(
      (p) => /\bCoverage Level\b/i.test(p.innerText) && /:\s*/.test(p.innerText),
    );
    let coverageLevel = spanAfter(levP);
    if (!coverageLevel) {
      const levLoose = ps.find((p) => /\bCoverage Level\b/i.test(p.innerText));
      coverageLevel = spanAfter(levLoose);
    }

    let patientNameOnFile = '';
    if (card) {
      const h4 = card.querySelector('#patient-summary p.h4') || card.querySelector('p.h4');
      patientNameOnFile = h4 ? h4.innerText.trim() : '';
    }
    if (!patientNameOnFile) {
      const summary = document.querySelector('#patient-summary');
      const h4s = summary && summary.querySelector('p.h4');
      patientNameOnFile = h4s ? h4s.innerText.trim() : '';
    }
    if (!patientNameOnFile) {
      const looksLikeMemberIdOnly = (s) => {
        const t = String(s || '').trim();
        if (t.length < 6 || t.length > 32) return false;
        if (/,/.test(t)) return false;
        return /^[A-Z0-9-]+$/i.test(t) && /\d/.test(t);
      };
      const lastCommaFirst = (s) =>
        /[A-Za-z][A-Za-z'\-\s]{1,50},\s*[A-Za-z][A-Za-z'\-\s]{1,50}/.test(String(s));
      const candidates = [
        document.querySelector('.list-group-item-heading p.h4'),
        document.querySelector('header p.h4'),
        ...document.querySelectorAll('main p.h4'),
      ].filter(Boolean);
      for (const el of candidates) {
        const t = el.innerText.replace(/\s+/g, ' ').trim();
        if (!t || looksLikeMemberIdOnly(t)) continue;
        if (lastCommaFirst(t)) {
          patientNameOnFile = t;
          break;
        }
      }
    }

    let benefitLine = '';
    if (card) {
      const benefitSmall = card.querySelector('.list-group-item div small');
      benefitLine = benefitSmall ? benefitSmall.innerText.trim() : '';
    }

    const alert = document.querySelector('.MuiAlert-message');
    const alertText = alert ? alert.innerText.trim() : '';

    return {
      labels,
      chipText,
      planProduct,
      insuranceType,
      coverageLevel,
      patientNameOnFile,
      benefitLine,
      alertText,
      parseHints: {
        hadPatientCard: Boolean(card),
        hadPlanDetailsSummary: Boolean(planList),
        parseIncomplete: !card && !planList,
      },
    };
  });
}

function looksLikePayerMemberIdToken(s) {
  const t = String(s || '').trim();
  if (t.length < 6 || t.length > 36) return false;
  if (/,/.test(t)) return false;
  return /^[A-Z0-9-]+$/i.test(t) && /\d/.test(t);
}

export function validateEligibilitySnapshotOrThrow(snap) {
  if (snap.alertText) throw new Error(snap.alertText);
  const L = snap.labels || {};
  const mid = String(L['Member ID'] || L['Subscriber ID'] || '').trim();
  if (snap.parseHints?.parseIncomplete && !mid) {
    throw new Error('Availity eligibility result summary did not render in time');
  }
}

export function mapAvailitySnapshotToResultRow(snap) {
  const L = snap.labels || {};
  const memberId = L['Member ID'] || L['Subscriber ID'] || '';
  const payerId = L['Payer ID'] || '';
  const dateOfService = L['Date of Service'] || '';
  const transactionDate = L['Transaction Date'] || '';
  const chip = snap.chipText || '';
  const isActive = /active coverage/i.test(chip) && !/inactive|not eligible/i.test(chip);

  let patientNameOnFile = snap.patientNameOnFile || null;
  if (patientNameOnFile && (patientNameOnFile === memberId || looksLikePayerMemberIdToken(patientNameOnFile))) {
    patientNameOnFile = null;
  }

  return {
    coverageStatusText: chip || null,
    isActive,
    memberId: memberId || null,
    payerId: payerId || null,
    patientNameOnFile,
    benefitLine: snap.benefitLine || null,
    dateOfService: dateOfService || null,
    transactionDate: transactionDate || null,
    insuranceType: snap.insuranceType || null,
    planProduct: snap.planProduct || null,
    coverageLevel: snap.coverageLevel || null,
    rawSnapshot: snap,
  };
}
