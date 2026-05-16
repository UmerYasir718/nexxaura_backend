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
  // Avoid matching unrelated Availity URLs that merely contain "authenticat" (e.g. FR app paths).
  if (/[/\-#]mfa|multi-?factor|verify[-_]?code|challenge|duo|okta|two-?factor/i.test(url))
    return true;
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

async function loginCredentialFormVisible(page) {
  const userField = page.locator('input#userId,input[name="userId"]').first();
  const passField = page.locator('input#password,input[name="password"][type="password"]').first();
  return (
    (await userField.isVisible({ timeout: 500 }).catch(() => false)) &&
    (await passField.isVisible({ timeout: 500 }).catch(() => false))
  );
}

/** Logged-in Availity shell (FR app or Essentials navigation), not login/MFA. */
async function pageLooksLikeAuthenticatedAvailityShell(page) {
  const url = page.url();
  if (!/availity\.com/i.test(url)) return false;
  if (await pageLooksLikeMfaChallenge(page)) return false;
  if (await loginCredentialFormVisible(page)) return false;

  const methodRadio = page
    .getByRole('radio', { name: /Authenticator app|authenticator|phone|email|text message/i })
    .first();
  if (await methodRadio.isVisible({ timeout: 400 }).catch(() => false)) return false;

  if (/loadApp.*eligibility/i.test(url) || /appUrl=.*eligibility/i.test(url)) return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation/i.test(url)) return true;
  if (/static\/web\/pres\/web\/eligibility/i.test(url)) return true;

  if (/availity-fr-ui/i.test(url) && !/#\/login\b/i.test(url)) return true;

  const shellHints = [
    page.getByRole('link', { name: /sign out|log out/i }),
    page.getByRole('button', { name: /sign out|log out/i }),
    page.locator('a[href*="#/home"],a[href*="#/dashboard"],a[href*="#/landing"]'),
    page.getByText(/essentials|home|dashboard|my apps/i),
  ];
  for (const hint of shellHints) {
    if (await hint.first().isVisible({ timeout: 600 }).catch(() => false)) return true;
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

  if (await pageLooksLikeAuthenticatedAvailityShell(page)) return true;

  if (
    /availity\.com/i.test(url) &&
    !/#\/login\b/i.test(url) &&
    !(await loginCredentialFormVisible(page))
  ) {
    return true;
  }

  return false;
}

/**
 * After OTP submit Availity may stay on fr-ui/#/login briefly before redirect.
 * @returns {Promise<boolean>}
 */
async function waitForAvailitySessionAfterMfa(page, contentFrameSel, logger, maxWaitMs = 120000) {
  const deadline = Date.now() + maxWaitMs;
  let lastDiagLog = 0;
  while (Date.now() < deadline) {
    if (await isEligibilityFormVisible(page, contentFrameSel)) {
      logger?.info?.('MFA: eligibility form visible — session ready');
      return true;
    }
    if (await pageLooksLikePostMfaSession(page, contentFrameSel)) {
      logger?.info?.(`MFA: authenticated shell detected (${page.url()})`);
      return true;
    }
    if (Date.now() - lastDiagLog > 15_000) {
      const mfa = await pageLooksLikeMfaChallenge(page);
      const loginForm = await loginCredentialFormVisible(page);
      logger?.info?.(
        `MFA: waiting for post-login redirect (url=${page.url()} mfa=${mfa} loginForm=${loginForm})`,
      );
      lastDiagLog = Date.now();
    }
    await sleep(1000);
  }
  return false;
}

/** True when user must sign in (expired session), not just slow eligibility load. */
async function pageNeedsAvailityLogin(page) {
  if (await loginCredentialFormVisible(page)) return true;
  const url = page.url();
  if (/availity-fr-ui/i.test(url) && /#\/login\b/i.test(url)) return true;
  return false;
}

/**
 * Re-open eligibility only when cookies are valid but the form did not render yet.
 * @returns {Promise<boolean>}
 */
async function tryRecoverEligibilitySession(page, av, logger) {
  const url = page.url();
  if (await pageNeedsAvailityLogin(page)) {
    logger?.info?.(
      `Availity: skip eligibility recovery — login required (url=${url})`,
    );
    return false;
  }
  if (!(await pageLooksLikeAuthenticatedAvailityShell(page))) {
    logger?.info?.(
      `Availity: skip eligibility recovery — no authenticated shell (url=${url})`,
    );
    return false;
  }
  logger?.info?.(
    `Availity: authenticated shell without eligibility form — retrying eligibility URL (url=${url})`,
  );
  return navigateToEligibilityAfterLogin(page, av, logger, { maxWaitMs: 25000 });
}

/**
 * Open eligibility loader after login when MFA landed on FR shell / navigation root.
 * @returns {Promise<boolean>}
 */
async function navigateToEligibilityAfterLogin(page, av, logger, opts = {}) {
  const eligUrl = String(av?.eligibilityAppUrl || '').trim();
  const maxWaitMs = Number(opts.maxWaitMs) > 0 ? Number(opts.maxWaitMs) : 90000;
  if (!eligUrl) return false;

  if (await pageNeedsAvailityLogin(page)) {
    logger?.info?.(
      `Availity: skip eligibility navigation — login page (url=${page.url()})`,
    );
    return false;
  }

  logger?.info?.(`Availity: navigating to eligibility (${eligUrl})`);
  await page.goto(eligUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await tryClickCookieConsent(page, logger);
  logger?.info?.(`Availity: after eligibility goto url=${page.url()}`);

  if (await pageNeedsAvailityLogin(page)) {
    logger?.info?.('Availity: eligibility URL redirected to login — session expired');
    return false;
  }

  const deadline = Date.now() + maxWaitMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (await sessionLooksReadyForEligibility(page, av.contentFrameSelector)) {
      logger?.info?.('Availity: eligibility ready after navigation');
      return true;
    }
    if (await pageNeedsAvailityLogin(page)) {
      logger?.info?.('Availity: login appeared while waiting for eligibility form');
      return false;
    }
    if (Date.now() - lastLog > 5000) {
      logger?.info?.(
        `Availity: waiting for eligibility form (${Math.round((deadline - Date.now()) / 1000)}s left, url=${page.url()})`,
      );
      lastLog = Date.now();
    }
    await sleep(1000);
  }
  logger?.warn?.(
    `Availity: eligibility not ready after navigation (url=${page.url()})`,
  );
  return false;
}

/** True when the eligibility inquiry form (#organization-field) is visible in the content iframe. */
async function isEligibilityFormVisible(page, frameSelector) {
  const selector = String(frameSelector || 'iframe#newBodyFrame');
  const frameEl = page.locator(selector).first();
  if (!(await frameEl.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  const handle = await frameEl.elementHandle().catch(() => null);
  if (!handle) return false;
  const frame = await handle.contentFrame().catch(() => null);
  await handle.dispose().catch(() => {});
  if (!frame) return false;
  return frame
    .locator('#organization-field')
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);
}

async function sessionLooksReadyForEligibility(page, contentFrameSel) {
  if (await isEligibilityFormVisible(page, contentFrameSel)) return true;
  return pageLooksLikePostMfaSession(page, contentFrameSel);
}

/**
 * After username/password: run MFA, but one-time code comes from our API (Redis) via getOtp().
 * onAwaitingOtp() is called the first time we detect a challenge.
 */
async function availityPostLoginMfaWithApiOtp(page, logger, av, { onAwaitingOtp, getOtp }) {
  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('MFA: session already active before MFA step; skipping');
    return;
  }

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

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('MFA: session became active after method selection; skipping OTP');
    return;
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
  let otpSubmitted = false;
  const otpish =
    'input#code,input[inputmode="numeric"],input[name="otp"],input[name="code"],input[autocomplete="one-time-code"],input[aria-label*="code" i],input[placeholder*="code" i]';

  const finishIfSessionReady = async () => {
    if (await waitForAvailitySessionAfterMfa(page, av.contentFrameSelector, logger, 8000)) {
      logger?.info?.('MFA: complete');
      await tryClickCookieConsent(page, logger);
      return true;
    }
    return false;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await finishIfSessionReady()) return;

    if (Date.now() - lastStepLog > 30_000) {
      logger?.info?.(
        `MFA: waiting (poll or app OTP) url=${page.url()} otpSubmitted=${otpSubmitted}`,
      );
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
          logger?.info?.('MFA: submitted OTP via Enter');
        }
      }
      otpSubmitted = true;
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
      if (await waitForAvailitySessionAfterMfa(page, av.contentFrameSelector, logger, 90000)) {
        logger?.info?.('MFA: complete after OTP');
        await tryClickCookieConsent(page, logger);
        return;
      }
      continue;
    }

    if (otpSubmitted) {
      if (await waitForAvailitySessionAfterMfa(page, av.contentFrameSelector, logger, 15000)) {
        logger?.info?.('MFA: complete (post-OTP, challenge cleared)');
        await tryClickCookieConsent(page, logger);
        return;
      }
      if (await navigateToEligibilityAfterLogin(page, av, logger)) {
        logger?.info?.('MFA: complete after eligibility navigation');
        await tryClickCookieConsent(page, logger);
        return;
      }
    }

    await sleep(2000);
  }

  if (otpSubmitted) {
    const navigated = await navigateToEligibilityAfterLogin(page, av, logger);
    if (navigated) {
      logger?.info?.('MFA: complete after timeout recovery navigation');
      return;
    }
  }

  throw new Error(
    `Availity MFA: timed out waiting for post-login session (url=${page.url()}). Check OTP or increase AVAILITY_MFA_WAIT_MS.`,
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {{ config: { availity: object } }} ctxLike — config.availity only
 * @param {object} creds
 * @param {object} opts
 * @param {() => Promise<void>} opts.onAwaitingOtp
 * @param {() => Promise<string>} opts.getOtp
 */
async function availityLoginWithApiOtp(page, ctxLike, creds, logger, opts = {}) {
  const { onAwaitingOtp, getOtp, skipInitialGoto = false } = opts;
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

  if (await sessionLooksReadyForEligibility(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: eligibility session already active on current page; skipping login');
    return;
  }

  if (skipInitialGoto) {
    logger?.info?.(`Availity login (API OTP): staying on ${page.url()} (eligibility probe did not find form yet)`);
    await tryClickCookieConsent(page, logger);
    await sleep(800);
  } else {
    logger?.info?.('Availity login (API OTP)', loginUrl);
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await tryClickCookieConsent(page, logger);
    await sleep(800);
  }

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: already in session, skipping form');
    return;
  }

  await ensureAvailityLoginFormVisible(page, userSelectors, logger, loginUrl);

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: session became valid during pre-login');
    return;
  }

  let visibleUserSel = await waitForAnyVisibleSelector(page, userSelectors, 15000);
  if (!visibleUserSel && skipInitialGoto) {
    logger?.info?.('Availity: login form not on eligibility page; opening login URL');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await tryClickCookieConsent(page, logger);
    await sleep(800);
    await ensureAvailityLoginFormVisible(page, userSelectors, logger, loginUrl);
    if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
      logger?.info?.('Availity: session valid after opening login URL');
      return;
    }
    visibleUserSel = await waitForAnyVisibleSelector(page, userSelectors, 45000);
  } else if (!visibleUserSel) {
    visibleUserSel = await waitForAnyVisibleSelector(page, userSelectors, 45000);
  }

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

  if (await sessionLooksReadyForEligibility(page, av.contentFrameSelector)) {
    logger?.info?.('Availity: signed in without MFA challenge; skipping OTP');
    return;
  }

  await availityPostLoginMfaWithApiOtp(page, logger, av, { onAwaitingOtp, getOtp });
  await sleep(1500);
  await tryClickCookieConsent(page, logger);

  if (!(await sessionLooksReadyForEligibility(page, av.contentFrameSelector))) {
    await navigateToEligibilityAfterLogin(page, av, logger);
  }
}

module.exports = {
  availityLoginWithApiOtp,
  pageLooksLikePostMfaSession,
  pageNeedsAvailityLogin,
  isEligibilityFormVisible,
  sessionLooksReadyForEligibility,
  navigateToEligibilityAfterLogin,
  tryRecoverEligibilitySession,
  tryClickCookieConsent,
};
