const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function pageLooksLikeMfaChallenge(page) {
  const url = page.url();
  if (/mfa|multi-?factor|verify|challenge|authenticat|duo|okta/i.test(url)) return true;
  if (
    await page
      .locator('#2fa-totp-input-token-page-content-grid')
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false)
  ) {
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

async function pageLooksLikePostMfaSession(page, contentFrameSel) {
  const url = page.url();
  if (!/availity\.com/i.test(url)) return false;
  if (await pageLooksLikeMfaChallenge(page)) return false;

  const methodRadio = page
    .getByRole('radio', { name: /Authenticator app|authenticator|phone|email|text message/i })
    .first();
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
 * After username/password: run MFA, but one-time code comes from our API (Redis) via getOtp().
 * onAwaitingOtp() is called the first time we detect a challenge.
 */
async function availityPostLoginMfaWithApiOtp(page, logger, av, { onAwaitingOtp, getOtp }) {
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
      logger?.info?.('MFA: challenge visible without method step — will wait for code from app');
    } else {
      logger?.info?.('MFA: authenticator method UI not found — checking session');
      if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) return;
    }
  }

  const startedAt = Date.now();
  let lastStepLog = 0;
  let markedAwaiting = false;
  const otpish =
    'input#code,input[inputmode="numeric"],input[name="otp"],input[name="code"],input[autocomplete="one-time-code"],input[aria-label*="code" i],input[placeholder*="code" i]';

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
      logger?.info?.('MFA: complete');
      await tryClickCookieConsent(page, logger);
      return;
    }
    if (Date.now() - lastStepLog > 30_000) {
      logger?.info?.('MFA: waiting (poll or app OTP)');
      lastStepLog = Date.now();
    }
    if (!waitForever && Date.now() - startedAt >= timeoutMs && timeoutMs > 0) {
      break;
    }
    if (await pageLooksLikeMfaChallenge(page)) {
      if (!markedAwaiting) {
        markedAwaiting = true;
        if (onAwaitingOtp) await onAwaitingOtp();
      }
      const code = await getOtp();
      const input = page.locator(otpish).first();
      await input.waitFor({ state: 'visible', timeout: 120000 });
      await input.fill('', { timeout: 5000 }).catch(() => {});
      await input.fill(String(code), { timeout: 20000 });
      await sleep(500);
      const verify = page
        .getByRole('button', { name: /verify|submit|continue|log\s*in/i })
        .first();
      if (await verify.isVisible().catch(() => false)) {
        await verify.click({ timeout: 20000 });
        logger?.info?.('MFA: clicked post-code button');
      } else {
        const alt2 = page.locator('input[type="submit"],button[type="submit"]').first();
        if (await alt2.isVisible().catch(() => false)) {
          await alt2.click({ timeout: 20000 });
          logger?.info?.('MFA: clicked submit for OTP');
        } else {
          await input.press('Enter').catch(() => {});
        }
      }
      await sleep(2500);
      continue;
    }
    await sleep(2000);
  }

  throw new Error('Availity MFA: timed out waiting for post-login session. Check OTP flow or increase AVAILITY_MFA_WAIT_MS.');
}

/**
 * @param {import('playwright').Page} page
 * @param {{ config: { availity: object } }} ctxLike — config.availity only
 * @param {object} creds
 * @param {object} opts
 * @param {() => Promise<void>} opts.onAwaitingOtp
 * @param {() => Promise<string>} opts.getOtp
 */
async function availityLoginWithApiOtp(page, ctxLike, creds, logger, { onAwaitingOtp, getOtp }) {
  const av = ctxLike.config.availity;
  const { loginUrl, username, password } = { loginUrl: av.loginUrl, username: creds.username, password: creds.password };
  const userSelectors =
    process.env.SEL_AVAILITY_USER ||
    'input[name="username"],input#username,input#userId,input[name="userId"],input[autocomplete="username"]';
  const passSelectors =
    process.env.SEL_AVAILITY_PASS ||
    'input[name="password"],input#password,input[type="password"],input[autocomplete="current-password"]';
  const submitSelectors =
    process.env.SEL_AVAILITY_SUBMIT ||
    'button[type="submit"],button:has-text("Sign In"),button:has-text("Log In"),button:has-text("Login")';

  logger?.info?.('Availity login (API OTP)', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await tryClickCookieConsent(page, logger);
  await sleep(800);

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: already in session, skipping form');
    return;
  }

  await ensureAvailityLoginFormVisible(page, userSelectors, logger, loginUrl);

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: session became valid during pre-login');
    return;
  }

  const visibleUserSel = await waitForAnyVisibleSelector(page, userSelectors, 45000);
  if (!visibleUserSel) {
    if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
      return;
    }
    throw new Error(`Availity login: user input not visible. URL=${page.url()}`);
  }
  await firstVisibleFill(page, userSelectors, username, logger);
  await firstVisibleFill(page, passSelectors, password, logger);
  await firstVisibleClick(page, submitSelectors, logger);
  await page.waitForURL(/availity\.com/i, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await tryClickCookieConsent(page, logger);

  await availityPostLoginMfaWithApiOtp(page, logger, av, { onAwaitingOtp, getOtp });
  await sleep(1500);
  await tryClickCookieConsent(page, logger);
}

module.exports = { availityLoginWithApiOtp, pageLooksLikePostMfaSession, tryClickCookieConsent };
