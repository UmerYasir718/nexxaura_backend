/**
 * Availity eligibility — function API. ctx = { config, logger, browser }.
 * config matches loadAvailityConfig() (includes nested config.availity).
 */

import fs from "fs";
import path from "path";

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUsDateFromIso(isoDate) {
  if (isoDate == null || isoDate === "") return "";
  if (isoDate instanceof Date) {
    if (Number.isNaN(isoDate.getTime())) return "";
    // Use UTC components so date-only DB values never shift by local timezone.
    const m = String(isoDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(isoDate.getUTCDate()).padStart(2, "0");
    const y = isoDate.getUTCFullYear();
    return `${m}/${day}/${y}`;
  }

  const s = String(isoDate).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[2]}/${ymd[3]}/${ymd[1]}`;

  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

function todayUsDate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

function yesterdayUsDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function tryClickCookieConsent(page, logger) {
  const candidates = [
    "#accept-recommended-btn-handler",
    "#onetrust-accept-btn-handler",
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
    .split(",")
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
  throw new Error(
    `Availity login: no visible user field for: ${list.join(" | ")}`,
  );
}

async function hasVisibleSelector(page, selectors, timeoutMs = 1200) {
  const list = String(selectors)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of list) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: timeoutMs }).catch(() => false))
      return true;
  }
  return false;
}

async function waitForAnyVisibleSelector(page, selectors, timeoutMs = 45000) {
  const list = String(selectors)
    .split(",")
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
    .split(",")
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
  throw new Error(`Availity login: no visible submit for: ${list.join(" | ")}`);
}

async function ensureAvailityLoginFormVisible(
  page,
  userSelectors,
  logger,
  loginUrl,
) {
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

  const fallbackLoginUrl = /#\/login/i.test(String(loginUrl || ""))
    ? loginUrl
    : `${String(loginUrl || "").replace(/\/+$/, "")}/#/login`;
  if (fallbackLoginUrl) {
    await page
      .goto(fallbackLoginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      })
      .catch(() => {});
    await sleep(900);
  }
}

/** True when MFA challenge UI is likely showing (OTP entry, etc.). */
async function pageLooksLikeMfaChallenge(page) {
  const url = page.url();
  if (/[/\-#]mfa|multi-?factor|verify[-_]?code|challenge|duo|okta|two-?factor/i.test(url))
    return true;
  if (
    await page
      .locator("#2fa-totp-input-token-page-content-grid")
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
  const passField = page
    .locator('input#password,input[name="password"][type="password"]')
    .first();
  return (
    (await userField.isVisible({ timeout: 500 }).catch(() => false)) &&
    (await passField.isVisible({ timeout: 500 }).catch(() => false))
  );
}

async function pageLooksLikeAuthenticatedAvailityShell(page) {
  const url = page.url();
  if (!/availity\.com/i.test(url)) return false;
  if (await pageLooksLikeMfaChallenge(page)) return false;
  if (await loginCredentialFormVisible(page)) return false;

  const methodRadio = page
    .getByRole("radio", {
      name: /Authenticator app|authenticator|phone|email|text message/i,
    })
    .first();
  if (await methodRadio.isVisible({ timeout: 400 }).catch(() => false))
    return false;

  if (/loadApp.*eligibility/i.test(url) || /appUrl=.*eligibility/i.test(url))
    return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation/i.test(url))
    return true;
  if (/static\/web\/pres\/web\/eligibility/i.test(url)) return true;
  if (/availity-fr-ui/i.test(url) && !/#\/login\b/i.test(url)) return true;

  const shellHints = [
    page.getByRole("link", { name: /sign out|log out/i }),
    page.getByRole("button", { name: /sign out|log out/i }),
    page.locator('a[href*="#/home"],a[href*="#/dashboard"]'),
  ];
  for (const hint of shellHints) {
    if (await hint.first().isVisible({ timeout: 600 }).catch(() => false))
      return true;
  }
  return false;
}

/** True when login + MFA appear complete enough for the rest of the script. */
async function pageLooksLikePostMfaSession(page, contentFrameSel) {
  const url = page.url();
  if (!/availity\.com/i.test(url)) return false;

  if (await pageLooksLikeMfaChallenge(page)) return false;

  const methodRadio = page
    .getByRole("radio", {
      name: /Authenticator app|authenticator|phone|email|text message/i,
    })
    .first();
  if (await methodRadio.isVisible({ timeout: 400 }).catch(() => false))
    return false;

  if (/loadApp.*eligibility/i.test(url) || /appUrl=.*eligibility/i.test(url))
    return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation/i.test(url))
    return true;
  if (/static\/web\/onb\/onboarding-ui-apps\/navigation\/#\/?$/i.test(url))
    return true;

  const frameSel = String(contentFrameSel || "iframe#newBodyFrame");
  const frame = page.locator(frameSel).first();
  if (await frame.isVisible({ timeout: 600 }).catch(() => false)) {
    const handle = await frame.elementHandle().catch(() => null);
    if (handle) {
      const fr = await handle.contentFrame().catch(() => null);
      await handle.dispose().catch(() => {});
      if (fr) {
        const org = fr.locator("#organization-field").first();
        if (await org.isVisible({ timeout: 800 }).catch(() => false))
          return true;
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

async function waitForAvailitySessionAfterMfa(
  page,
  contentFrameSel,
  logger,
  maxWaitMs = 120000,
) {
  const deadline = Date.now() + maxWaitMs;
  let lastDiagLog = 0;
  while (Date.now() < deadline) {
    if (await isEligibilityFormVisible(page, contentFrameSel)) {
      logger?.info?.("MFA: eligibility form visible — session ready");
      return true;
    }
    if (await pageLooksLikePostMfaSession(page, contentFrameSel)) {
      logger?.info?.(`MFA: authenticated shell detected (${page.url()})`);
      return true;
    }
    if (Date.now() - lastDiagLog > 15_000) {
      logger?.info?.(
        `MFA: waiting for post-login redirect (url=${page.url()} mfa=${await pageLooksLikeMfaChallenge(page)} loginForm=${await loginCredentialFormVisible(page)})`,
      );
      lastDiagLog = Date.now();
    }
    await sleep(1000);
  }
  return false;
}

async function pageNeedsAvailityLogin(page) {
  if (await loginCredentialFormVisible(page)) return true;
  const url = page.url();
  if (/availity-fr-ui/i.test(url) && /#\/login\b/i.test(url)) return true;
  return false;
}

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
  return navigateToEligibilityAfterLogin(page, av, logger, { maxWaitMs: 25000 });
}

async function navigateToEligibilityAfterLogin(page, av, logger, opts = {}) {
  const eligUrl = String(av?.eligibilityAppUrl || "").trim();
  const maxWaitMs = Number(opts.maxWaitMs) > 0 ? Number(opts.maxWaitMs) : 90000;
  if (!eligUrl) return false;
  if (await pageNeedsAvailityLogin(page)) {
    logger?.info?.(
      `Availity: skip eligibility navigation — login page (url=${page.url()})`,
    );
    return false;
  }
  logger?.info?.(`Availity: navigating to eligibility (${eligUrl})`);
  await page
    .goto(eligUrl, { waitUntil: "domcontentloaded", timeout: 120000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await tryClickCookieConsent(page, logger);
  logger?.info?.(`Availity: after eligibility goto url=${page.url()}`);
  if (await pageNeedsAvailityLogin(page)) {
    logger?.info?.("Availity: eligibility URL redirected to login — session expired");
    return false;
  }
  const deadline = Date.now() + maxWaitMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (await sessionLooksReadyForEligibility(page, av.contentFrameSelector)) {
      logger?.info?.("Availity: eligibility ready after navigation");
      return true;
    }
    if (await pageNeedsAvailityLogin(page)) return false;
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

/**
 * After username/password: select Authenticator app MFA method, Continue, then wait for manual OTP success.
 * @param {import('playwright').Page} page
 * @param {object} logger
 * @param {object} av — `config.availity` from loadAvailityConfig()
 */
async function availityPostLoginMfaFlow(page, logger, av) {
  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.("MFA: session already active before MFA step; skipping");
    return;
  }

  const methodPhrase = String(
    av.mfaAuthenticatorMethodText || "Authenticator app",
  ).trim();
  const methodRe = new RegExp(escapeRe(methodPhrase), "i");
  const shortRe = /Authenticator app/i;
  const rawTimeout = Number(av.mfaWaitTimeoutMs);
  const timeoutMs = Number.isFinite(rawTimeout) ? rawTimeout : 0;
  const waitForever = timeoutMs <= 0;

  await sleep(2000);
  await tryClickCookieConsent(page, logger);

  let selectedMethod = false;
  const radio = page.getByRole("radio", { name: methodRe }).first();
  if (await radio.isVisible({ timeout: 6000 }).catch(() => false)) {
    await radio.click({ timeout: 15000 });
    selectedMethod = true;
    logger?.info?.("MFA: selected Authenticator app (radio)");
  }
  if (!selectedMethod) {
    const radio2 = page.getByRole("radio", { name: shortRe }).first();
    if (await radio2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await radio2.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.("MFA: selected Authenticator app (radio, short match)");
    }
  }
  if (!selectedMethod) {
    const label = page.locator("label").filter({ hasText: methodRe }).first();
    if (await label.isVisible({ timeout: 4000 }).catch(() => false)) {
      await label.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.("MFA: clicked Authenticator method label");
    }
  }
  if (!selectedMethod) {
    const row = page.getByText(methodRe, { exact: false }).first();
    if (await row.isVisible({ timeout: 4000 }).catch(() => false)) {
      await row.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.("MFA: clicked Authenticator method text");
    }
  }
  if (!selectedMethod) {
    const domRadio = page
      .locator('input[type="radio"][name="choice"][value*="Authenticator"]')
      .first();
    if (await domRadio.isVisible({ timeout: 4000 }).catch(() => false)) {
      await domRadio.click({ timeout: 15000 });
      selectedMethod = true;
      logger?.info?.(
        "MFA: selected Authenticator (input[name=choice] per Availity FR UI)",
      );
    }
  }

  if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector)) {
    logger?.info?.(
      "MFA: session became active after method selection; skipping OTP wait",
    );
    return;
  }

  if (selectedMethod) {
    const continueBtn = page
      .getByRole("button", { name: /^(Continue|Next)$/i })
      .first();
    if (await continueBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await continueBtn.click({ timeout: 20000 });
      logger?.info?.("MFA: clicked Continue after method selection");
    } else {
      const alt = page
        .locator(
          'button:has-text("Continue"),input[type="submit"][value*="Continue" i]',
        )
        .first();
      if (await alt.isVisible({ timeout: 4000 }).catch(() => false)) {
        await alt.click({ timeout: 20000 });
        logger?.info?.("MFA: clicked Continue (fallback selector)");
      }
    }
    await sleep(1500);
  } else {
    if (await pageLooksLikeMfaChallenge(page)) {
      logger?.info?.(
        "MFA: challenge visible without method step — waiting for code entry",
      );
    } else {
      logger?.info?.(
        "MFA: authenticator method UI not found — assuming no MFA or already past",
      );
      if (await pageLooksLikePostMfaSession(page, av.contentFrameSelector))
        return;
    }
  }

  const startedAt = Date.now();
  let lastStepLog = 0;
  while (true) {
    if (await waitForAvailitySessionAfterMfa(page, av.contentFrameSelector, logger, 5000)) {
      logger?.step?.("MFA", "Authenticator flow complete");
      await tryClickCookieConsent(page, logger);
      return;
    }
    if (Date.now() - lastStepLog > 30_000) {
      logger?.step?.(
        "MFA",
        `Waiting for authenticator code — enter in browser (url=${page.url()})`,
      );
      lastStepLog = Date.now();
    }
    if (!waitForever && Date.now() - startedAt >= timeoutMs) break;

    if (!(await pageLooksLikeMfaChallenge(page))) {
      if (await waitForAvailitySessionAfterMfa(page, av.contentFrameSelector, logger, 10000)) {
        logger?.step?.("MFA", "Authenticator flow complete (challenge cleared)");
        await tryClickCookieConsent(page, logger);
        return;
      }
      if (await navigateToEligibilityAfterLogin(page, av, logger)) {
        logger?.step?.("MFA", "Authenticator flow complete (via eligibility URL)");
        await tryClickCookieConsent(page, logger);
        return;
      }
    }

    await sleep(2000);
  }

  if (await navigateToEligibilityAfterLogin(page, av, logger)) {
    logger?.step?.("MFA", "Authenticator flow complete (timeout recovery)");
    return;
  }

  throw new Error(
    `Availity MFA: timed out after ${timeoutMs}ms (url=${page.url()}). Enter the code in the browser or increase AVAILITY_MFA_WAIT_MS.`,
  );
}

async function pickAutocompleteOption(
  frame,
  inputCss,
  query,
  optionNameRe,
  logger,
) {
  const box = frame.locator(inputCss).first();
  await box.click({ timeout: 20000 });
  await box.fill("");
  await box.fill(query);
  await sleep(600);
  const listbox = frame.getByRole("listbox");
  await listbox.waitFor({ state: "visible", timeout: 25000 });
  const opt = frame.getByRole("option", { name: optionNameRe }).first();
  await opt.click({ timeout: 20000 });
  logger?.info?.(
    `Autocomplete ${inputCss} → picked option matching ${optionNameRe}`,
  );
  await sleep(400);
}

async function pickAutocompleteOptionFirstMatch(
  frame,
  inputCss,
  query,
  logger,
) {
  const box = frame.locator(inputCss).first();
  await box.click({ timeout: 20000 });
  await box.fill("");
  await box.fill(query);
  await sleep(800);
  const listbox = frame.getByRole("listbox");
  await listbox.waitFor({ state: "visible", timeout: 25000 });
  const opt = frame.locator('[role="option"]').first();
  await opt.click({ timeout: 20000 });
  logger?.info?.(`Autocomplete ${inputCss} → first option`);
  await sleep(400);
}

async function fillMuiMultiSectionDate(
  frame,
  ariaLabelledById,
  usDate,
  logger,
) {
  const group = frame
    .locator(`div[role="group"][aria-labelledby="${ariaLabelledById}"]`)
    .first();
  await group.waitFor({ state: "visible", timeout: 30000 });
  await group.locator(".MuiPickersSectionList-root").click({ timeout: 10000 });
  await sleep(200);
  const pg = frame.page();
  await pg.keyboard.press("Control+a");
  await pg.keyboard.type(usDate, { delay: 35 });
  logger?.info?.(`Set date (${ariaLabelledById}): ${usDate}`);
  await sleep(300);
}

async function safeOptionalAutocomplete(
  frame,
  inputCss,
  query,
  optionRe,
  logger,
  label,
) {
  try {
    const box = frame.locator(inputCss).first();
    if (!(await box.isVisible({ timeout: 2000 }).catch(() => false))) return;
    const cur = await box.inputValue().catch(() => "");
    if (cur && cur.trim()) {
      logger?.info?.(`${label} already filled, skipping`);
      return;
    }
    await pickAutocompleteOption(frame, inputCss, query, optionRe, logger);
  } catch (e) {
    logger?.warn?.(`${label} optional fill failed: ${e.message || e}`);
  }
}

/** True when the eligibility inquiry form is visible inside the Availity content iframe. */
export async function isEligibilityFormVisible(page, frameSelector) {
  const selector = String(frameSelector || "iframe#newBodyFrame");
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
    .locator("#organization-field")
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);
}

async function sessionLooksReadyForEligibility(page, contentFrameSel) {
  if (await isEligibilityFormVisible(page, contentFrameSel)) return true;
  return pageLooksLikePostMfaSession(page, contentFrameSel);
}

/**
 * With saved Playwright storage state, open the eligibility app and skip login when the form loads.
 * @returns {Promise<boolean>} true when login/MFA can be skipped
 */
export async function availityTryRestoreSavedSession(ctx) {
  const page = ctx.browser.page;
  const av = ctx.config.availity;
  const eligUrl = av.eligibilityAppUrl;
  if (!eligUrl) return false;

  ctx.logger.info(
    `Availity: probing saved session via eligibility (${eligUrl})`,
  );
  await page
    .goto(eligUrl, { waitUntil: "domcontentloaded", timeout: 180000 })
    .catch(() => {});
  await page
    .waitForLoadState("networkidle", { timeout: 120000 })
    .catch(() => {});
  await tryClickCookieConsent(page, ctx.logger);
  await sleep(600);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await pageNeedsAvailityLogin(page)) {
      ctx.logger.info(
        `Availity: session probe — login required (url=${page.url()})`,
      );
      return false;
    }
    if (await sessionLooksReadyForEligibility(page, av.contentFrameSelector)) {
      ctx.logger.info(
        "Availity: saved session works on eligibility — skipping login / MFA",
      );
      await ctx.browser.saveStorageState?.().catch(() => {});
      return true;
    }
    await sleep(1000);
  }
  ctx.logger.info(
    "Availity: eligibility app did not load with saved session; will use login flow",
  );
  const recovered = await tryRecoverEligibilitySession(page, av, ctx.logger);
  if (recovered) {
    ctx.logger.info(
      "Availity: saved session recovered after eligibility re-open",
    );
    await ctx.browser.saveStorageState?.().catch(() => {});
    return true;
  }
  return false;
}

export async function availityGetContentFrame(ctx) {
  const sel = ctx.config.availity.contentFrameSelector;
  const page = ctx.browser.page;
  const handle = await page
    .locator(sel)
    .first()
    .elementHandle({ timeout: 120000 });
  if (!handle) throw new Error(`Availity: iframe not found: ${sel}`);
  const fr = await handle.contentFrame();
  await handle.dispose();
  if (!fr) throw new Error(`Availity: no contentDocument for ${sel}`);
  return fr;
}

export async function availityLogin(ctx) {
  const { loginUrl, username, password } = ctx.config.availity;
  const page = ctx.browser.page;
  const frameSel = ctx.config.availity.contentFrameSelector;

  if (await availityTryRestoreSavedSession(ctx)) return;

  ctx.logger.step("Availity login", loginUrl);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await tryClickCookieConsent(page, ctx.logger);
  await sleep(800);

  // Storage-state sessions may open directly into the navigation shell/dashboard.
  // In that case, there is no login form and we should skip credential submission.
  if (await pageLooksLikePostMfaSession(page, frameSel)) {
    ctx.logger.info(
      "Availity session already authenticated; skipping login form",
    );
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

  await ensureAvailityLoginFormVisible(
    page,
    userSelectors,
    ctx.logger,
    loginUrl,
  );

  // Re-check after pre-login helpers because a valid session can still redirect
  // into navigation while we were trying login-entry steps.
  if (
    await pageLooksLikePostMfaSession(
      page,
      ctx.config.availity.contentFrameSelector,
    )
  ) {
    ctx.logger.info(
      "Availity session became authenticated during login pre-check; skipping credentials",
    );
    await tryClickCookieConsent(page, ctx.logger);
    await ctx.browser.saveStorageState?.();
    return;
  }

  const visibleUserSel = await waitForAnyVisibleSelector(
    page,
    userSelectors,
    45000,
  );
  if (!visibleUserSel) {
    // Saved session can place us on the dashboard shell URL (navigation/#/) with no login fields.
    // Treat this as authenticated and allow the next step to open Eligibility directly.
    if (
      await pageLooksLikePostMfaSession(
        page,
        ctx.config.availity.contentFrameSelector,
      )
    ) {
      ctx.logger.warn(
        `Login form not visible, but dashboard session detected at ${page.url()}; skipping form login`,
      );
      await tryClickCookieConsent(page, ctx.logger);
      await ctx.browser.saveStorageState?.();
      return;
    }

    const compactParts = [];
    for (const s of userSelectors
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      const c = await page
        .locator(s)
        .count()
        .catch(() => 0);
      compactParts.push(`${s} count=${c}`);
    }
    const compact = compactParts.join(" | ");
    throw new Error(
      `Availity login: user input not visible after wait. URL=${page.url()} selectors=${compact}`,
    );
  }
  ctx.logger.info(`Login user field ready: ${visibleUserSel}`);
  await firstVisibleFill(page, userSelectors, username, ctx.logger);
  await firstVisibleFill(page, passSelectors, password, ctx.logger);
  await firstVisibleClick(page, submitSelectors, ctx.logger);

  await page.waitForURL(/availity\.com/i, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await tryClickCookieConsent(page, ctx.logger);

  if (await sessionLooksReadyForEligibility(page, frameSel)) {
    ctx.logger.info("Availity: signed in without MFA challenge; skipping OTP wait");
    await ctx.browser.saveStorageState?.();
    return;
  }

  await availityPostLoginMfaFlow(page, ctx.logger, ctx.config.availity);
  await sleep(1500);
  await tryClickCookieConsent(page, ctx.logger);
  if (
    !(await sessionLooksReadyForEligibility(
      page,
      ctx.config.availity.contentFrameSelector,
    ))
  ) {
    await navigateToEligibilityAfterLogin(
      page,
      ctx.config.availity,
      ctx.logger,
    );
  }
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
  if (!(await frameLoc.isVisible({ timeout: 2500 }).catch(() => false)))
    return false;
  const handle = await frameLoc.elementHandle().catch(() => null);
  if (!handle) return false;
  const fr = await handle.contentFrame().catch(() => null);
  await handle.dispose().catch(() => {});
  if (!fr) return false;
  const hasCard = await fr
    .locator("#patient-card")
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  if (!hasCard) return false;
  const orgVisible = await fr
    .locator("#organization-field")
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
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
    if (
      await fr
        .locator("#organization-field")
        .first()
        .isVisible({ timeout: 6000 })
        .catch(() => false)
    ) {
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
  const frameSel =
    ctx.config.availity.contentFrameSelector || "iframe#newBodyFrame";
  const eligibilityPathRe = /\/static\/web\/pres\/web\/eligibility\/?/i;
  const eligibilityShellRe = /appUrl=.*eligibility/i;
  const loaderEligibilityUrl =
    "https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpres%2Fweb%2Feligibility%2F";
  const directEligibilityUrl =
    "https://essentials.availity.com/static/web/pres/web/eligibility/";
  const openUrl =
    eligibilityPathRe.test(String(configuredUrl || "")) ||
    eligibilityShellRe.test(String(configuredUrl || ""))
      ? configuredUrl
      : loaderEligibilityUrl;
  const embedMaxWaitMs = opts.embedMaxWaitMs ?? 120_000;
  const embedAfterDirectMaxWaitMs = opts.embedAfterDirectMaxWaitMs ?? 90_000;
  const assignPollMs = opts.assignPollMs ?? 60_000;
  ctx.logger.step("Open eligibility app", openUrl);

  /** @param {string} target */
  const navigateAndSettle = async (target) => {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page
      .waitForLoadState("networkidle", { timeout: 90000 })
      .catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await sleep(1000);
  };

  const resetIfStuckOnResults = async (where) => {
    if (!(await eligibilityIframeShowsResultsWithoutForm(page, frameSel)))
      return;
    ctx.logger.warn(
      `[eligibility] inquiry results still in iframe (${where}); reloading top page so the form can load`,
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
    await page
      .waitForLoadState("networkidle", { timeout: 90_000 })
      .catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await sleep(800);
  };

  await resetIfStuckOnResults("before navigation");
  await navigateAndSettle(openUrl);
  await resetIfStuckOnResults("after navigation");

  const looksLikeEligibilityUrl = (u) =>
    eligibilityPathRe.test(u) || eligibilityShellRe.test(u);
  const onDirectEligibilityDocument = (u) =>
    eligibilityPathRe.test(u) && !eligibilityShellRe.test(u);

  const isEligibilityFrameReady = async () => {
    const frameLoc = page.locator(frameSel).first();
    if (!(await frameLoc.isVisible({ timeout: 8000 }).catch(() => false)))
      return false;
    const handle = await frameLoc.elementHandle().catch(() => null);
    if (!handle) return false;
    const fr = await handle.contentFrame().catch(() => null);
    await handle.dispose().catch(() => {});
    if (!fr) return false;
    return fr
      .locator("#organization-field")
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
      ctx.logger.info("[eligibility] eligibility form ready");
    } else if (!onDirectEligibilityDocument(page.url())) {
      ctx.logger.warn(
        `[eligibility] form not ready after ${Math.round(waitMsInitial / 1000)}s; navigating to direct eligibility URL`,
      );
      await navigateAndSettle(directEligibilityUrl);
      await resetIfStuckOnResults("after direct URL navigation");
      ctx.logger.info(
        `[eligibility] waiting for form after direct URL (up to ${Math.round(waitMsAfterDirect / 1000)}s)…`,
      );
      ok = await pollEligibilityFormVisible(page, frameSel, waitMsAfterDirect);
      if (ok)
        ctx.logger.info(
          "[eligibility] eligibility form ready after direct URL",
        );
    } else {
      ctx.logger.warn(
        `[eligibility] form not ready after ${Math.round(waitMsInitial / 1000)}s on direct eligibility URL`,
      );
    }
  } else {
    ctx.logger.warn(
      `[eligibility] unexpected URL after open (${page.url()}); navigating loader URL`,
    );
    await navigateAndSettle(loaderEligibilityUrl);
    await resetIfStuckOnResults("after loader URL navigation");
    await pollEligibilityFormVisible(page, frameSel, waitMsInitial);
  }

  if (
    !(looksLikeEligibilityUrl(page.url()) && (await isEligibilityFrameReady()))
  ) {
    ctx.logger.warn(
      `[eligibility] form still not ready (${page.url()}); forcing location.assign to loader`,
    );
    await page
      .evaluate((u) => window.location.assign(u), loaderEligibilityUrl)
      .catch(() => {});
    await sleep(1500);
    await page
      .waitForLoadState("domcontentloaded", { timeout: 120_000 })
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 90_000 })
      .catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await pollEligibilityFormVisible(page, frameSel, assignPollMs);
  }

  if (
    !(looksLikeEligibilityUrl(page.url()) && (await isEligibilityFrameReady()))
  ) {
    ctx.logger.warn(
      `[eligibility] form still not ready (${page.url()}); forcing location.assign to direct`,
    );
    await page
      .evaluate((u) => window.location.assign(u), directEligibilityUrl)
      .catch(() => {});
    await sleep(1500);
    await page
      .waitForLoadState("domcontentloaded", { timeout: 120_000 })
      .catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: 90_000 })
      .catch(() => {});
    await tryClickCookieConsent(page, ctx.logger);
    await pollEligibilityFormVisible(page, frameSel, assignPollMs);
  }

  if (!(await isEligibilityFrameReady())) {
    ctx.logger.info(
      "[eligibility] waiting for eligibility frame/form to become ready",
    );
    await page
      .locator(frameSel)
      .first()
      .waitFor({ state: "visible", timeout: 120000 });
    const frame = await availityGetContentFrame(ctx);
    await frame
      .locator("#organization-field")
      .first()
      .waitFor({ state: "visible", timeout: 120000 });
  } else {
    await page
      .locator(frameSel)
      .first()
      .waitFor({ state: "visible", timeout: 120000 });
  }

  await tryClickCookieConsent(page, ctx.logger);
  await sleep(800);
}

export async function availityFillInquiryForm(ctx, frame, patient) {
  const av = ctx.config.availity;
  const logger = ctx.logger;
  const payerRe = new RegExp(escapeRe(patient.payerName.trim()), "i");

  await pickAutocompleteOption(
    frame,
    "#organization-field",
    av.organizationQuery,
    new RegExp(av.organizationOptionRegex, "i"),
    logger,
  );

  try {
    await pickAutocompleteOption(
      frame,
      "#payerId-field",
      patient.payerName.trim(),
      payerRe,
      logger,
    );
  } catch (e) {
    logger.warn(
      `Payer strict match failed, trying first list match… (${e.message || e})`,
    );
    await pickAutocompleteOptionFirstMatch(
      frame,
      "#payerId-field",
      patient.payerName.trim().slice(0, 12),
      logger,
    );
  }

  const provRe = new RegExp(av.providerOptionRegex, "i");
  try {
    await pickAutocompleteOption(
      frame,
      "#provider",
      av.providerQuery,
      provRe,
      logger,
    );
  } catch (e) {
    logger.warn(
      `Provider regex match failed, trying NPI only… (${e.message || e})`,
    );
    await pickAutocompleteOption(
      frame,
      "#provider",
      "1093454423",
      /1093454423/,
      logger,
    );
  }

  await safeOptionalAutocomplete(
    frame,
    "#patientSearchOption",
    av.patientSearchOptionQuery,
    new RegExp(escapeRe(av.patientSearchOptionQuery), "i"),
    logger,
    "Patient search option",
  );

  await safeOptionalAutocomplete(
    frame,
    "#subscriberRelationship-field",
    av.subscriberRelationshipQuery,
    new RegExp(escapeRe(av.subscriberRelationshipQuery), "i"),
    logger,
    "Subscriber relationship",
  );

  const memberInput = frame.locator('input[name="memberId"]').first();
  await memberInput.fill(patient.memberId.trim(), { timeout: 20000 });

  const dobUs = formatUsDateFromIso(patient.patientDobIso);
  if (!dobUs) throw new Error("Patient DOB missing or invalid");
  await fillMuiMultiSectionDate(
    frame,
    "patientBirthDatefield-picker-label",
    dobUs,
    logger,
  );

  await fillMuiMultiSectionDate(
    frame,
    "asOfDate-picker-label",
    yesterdayUsDate(),
    logger,
  );

  const svcRe = new RegExp(av.benefitServiceTypeOptionRe, "i");
  await pickAutocompleteOption(
    frame,
    "#serviceType",
    av.benefitServiceTypeQuery,
    svcRe,
    logger,
  );
}

export async function availitySubmitInquiry(ctx, frame) {
  await frame
    .getByRole("button", { name: /^submit$/i })
    .click({ timeout: 30000 });
  ctx.logger.info("Submitted eligibility inquiry");
}

export async function availityWaitForResponse(ctx, frame) {
  const memberLine = frame.locator(".patient-card-extended-label", {
    hasText: /member id/i,
  });
  const chip = frame.getByText(/active coverage|inactive|not eligible/i);
  const err = frame.locator(".MuiAlert-message");
  await Promise.race([
    memberLine.first().waitFor({ state: "visible", timeout: 180000 }),
    chip.first().waitFor({ state: "visible", timeout: 180000 }),
    err.first().waitFor({ state: "visible", timeout: 180000 }),
  ]);
  await availityWaitForResultDetailDom(frame);
}

/**
 * After chip/member line appears, summary blocks can paint a beat later. Avoid parsing
 * when #patient-card / plan summary are still missing (wrong fallbacks).
 * @param {import('playwright').Frame} frame
 */
export async function availityWaitForResultDetailDom(frame) {
  const alertVis = await frame
    .locator(".MuiAlert-message")
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (alertVis) {
    await sleep(200);
    return;
  }
  const t = 15000;
  await Promise.race([
    frame.locator("#patient-card").waitFor({ state: "visible", timeout: t }),
    frame
      .locator("#plan-details-summary")
      .waitFor({ state: "visible", timeout: t }),
    frame
      .locator(".patient-card-extended-label", { hasText: /member id/i })
      .first()
      .waitFor({ state: "visible", timeout: t }),
  ]).catch(() => {});
  await sleep(500);
}

/**
 * Annual deductible / plan maximums live under "Health Benefit Plan Coverage".
 * Prefer Playwright clicks (React/MUI); DOM-only `click()` in evaluate often misses re-renders.
 * @param {import('playwright').Frame} frame
 * @param {any} logger
 * @returns {Promise<boolean>} true if an expand/reveal click was performed
 */
/**
 * Expand each benefit-category accordion (button with STC code span, e.g. " - 30").
 * @returns {Promise<{ total: number, expanded: number }>}
 */
export async function availityExpandAllBenefitAccordions(frame, logger) {
  const buttons = frame
    .locator("button")
    .filter({ has: frame.locator("span", { hasText: /^\s*-\s*\d{1,3}\s*$/ }) });
  const total = await buttons.count().catch(() => 0);
  let expanded = 0;
  for (let i = 0; i < total; i += 1) {
    try {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible({ timeout: 2000 }).catch(() => false))) continue;
      const card = btn.locator("xpath=ancestor::*[contains(@class,'MuiCard-root')][1]");
      const collapse = card.locator(".MuiCollapse-root").first();
      const collapseClass =
        (await collapse.getAttribute("class").catch(() => "")) || "";
      const hidden =
        collapseClass.includes("MuiCollapse-hidden") &&
        !collapseClass.includes("MuiCollapse-entered");
      if (!hidden) continue;
      await btn.click({ timeout: 15000 });
      await sleep(650);
      expanded += 1;
    } catch (e) {
      logger?.warn?.(
        `availityExpandAllBenefitAccordions[${i}]: ${e?.message || e}`,
      );
    }
  }
  if (total > 0) {
    logger?.info?.(
      `Availity: expanded ${expanded}/${total} benefit accordion(s) for co-pay/coinsurance parse`,
    );
  }
  return { total, expanded };
}

export async function availityExpandHealthBenefitPlanCoverageIfCollapsed(
  frame,
  logger,
) {
  try {
    const btn = frame
      .getByRole("button", { name: /Health Benefit Plan Coverage/i })
      .first();
    if ((await btn.count()) === 0) return false;
    if (!(await btn.isVisible({ timeout: 6000 }).catch(() => false)))
      return false;

    const card = frame
      .locator(".MuiCard-root, .MuiPaper-root")
      .filter({ has: btn })
      .first();
    const collapse = card.locator(".MuiCollapse-root").first();
    const collapseClass =
      (await collapse.getAttribute("class").catch(() => "")) || "";
    const looksCollapsed =
      collapseClass.includes("MuiCollapse-hidden") &&
      !collapseClass.includes("MuiCollapse-entered");

    const annualRow = frame
      .locator("tr")
      .filter({ has: frame.locator("td", { hasText: /Annual Deductible/i }) })
      .first();
    let detailProbe = "";
    if ((await annualRow.count()) > 0) {
      const lastTd = annualRow.locator("td").last();
      detailProbe = await lastTd
        .innerText({ timeout: 3000 })
        .catch(() => "");
    }
    const hasMoneyInDeductibleCell =
      /\$/.test(detailProbe) &&
      (/Calendar Year/i.test(detailProbe) || /Year to Date/i.test(detailProbe));

    if (looksCollapsed || !hasMoneyInDeductibleCell) {
      await btn.click({ timeout: 20000 });
      await sleep(1000);
      logger?.info?.(
        `Availity: clicked Health Benefit Plan Coverage (collapsed=${looksCollapsed}, hadMoneyInCell=${hasMoneyInDeductibleCell})`,
      );
      return true;
    }
    return false;
  } catch (e) {
    logger?.warn?.(
      `availityExpandHealthBenefitPlanCoverageIfCollapsed: ${e?.message || e}`,
    );
    return false;
  }
}

/**
 * @param {import('playwright').Frame} frame
 * @param {any} [logger]
 */
export function isEligibilityBenefitsCaptureEnabled() {
  const cap = String(process.env.AVAILITY_ELIGIBILITY_RESULT_CAPTURE || "")
    .trim()
    .toLowerCase();
  if (["0", "false", "no", "off"].includes(cap)) return false;
  const dir = String(process.env.AVAILITY_ELIGIBILITY_RESULT_DIR || "").trim();
  if (dir) return true;
  return ["1", "true", "yes", "on"].includes(cap);
}

/** @param {string} [syncId] */
export function getEligibilityCaptureBaseDir(syncId) {
  const relOrAbs = String(process.env.AVAILITY_ELIGIBILITY_RESULT_DIR || "").trim();
  const subdir = syncId ? String(syncId) : "adhoc";
  if (relOrAbs) {
    return path.isAbsolute(relOrAbs)
      ? path.join(relOrAbs, subdir)
      : path.resolve(process.cwd(), relOrAbs, subdir);
  }
  return path.resolve(process.cwd(), "debug", "availity-eligibility", subdir);
}

/**
 * Review-friendly JSON (PHI) — written when capture env is enabled.
 * @param {object} snap
 * @param {{ syncId?: string, patientId?: string, elRunId?: string, outcome?: string, logger?: any }} meta
 */
export async function saveEligibilityBenefitsDebugJson(snap, meta = {}) {
  if (!isEligibilityBenefitsCaptureEnabled()) return null;
  const {
    syncId,
    patientId,
    elRunId,
    outcome = "success",
    logger,
  } = meta;
  const baseDir = getEligibilityCaptureBaseDir(syncId);
  await fs.promises.mkdir(baseDir, { recursive: true });
  const slugPatient = String(patientId || "unknown").replace(
    /[^a-zA-Z0-9-_]/g,
    "_",
  );
  const base = `elig-${outcome}-${slugPatient}-${elRunId || "run"}`;
  const filePath = path.join(baseDir, `${base}-benefits.json`);
  const payload = buildEligibilityBenefitsPayload(snap);
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  logger?.info?.(`Availity eligibility benefits JSON: ${filePath}`);
  return filePath;
}

/** @param {object} snap */
export function buildEligibilityBenefitsPayload(snap) {
  const L = snap?.labels || {};
  const pc = snap?.patientCard || {};
  const plan = snap?.plan || {};
  const memberId =
    plan.memberId || pc.memberId || L["Member ID"] || L["Subscriber ID"] || null;
  const chip = snap?.chipText || "";
  const isActive =
    /active coverage/i.test(chip) && !/inactive|not eligible/i.test(chip);

  return {
    capturedAt: new Date().toISOString(),
    patient: {
      name: snap?.patientNameOnFile || null,
      memberId,
      payerId: pc.payerId || L["Payer ID"] || null,
      dateOfBirth: pc.dob || L["DOB"] || L["Date of Birth"] || null,
      dateOfService: pc.dateOfService || L["Date of Service"] || null,
      transactionDate: pc.transactionDate || L["Transaction Date"] || null,
      transactionTime: pc.transactionTime || L["Transaction Time"] || null,
      transactionId: pc.transactionId || L["Transaction ID"] || null,
      customerId: pc.customerId || L["Customer ID"] || null,
    },
    plan: {
      memberId,
      groupNumber: plan.groupNumber || L["Group Number"] || null,
      groupName: plan.groupName || L["Group Name"] || null,
      planNumber: plan.planNumber || L["Plan Number"] || null,
      planBeginDate: plan.planBeginDate || L["Plan Begin Date"] || null,
      eligibilityBeginDate:
        plan.eligibilityBeginDate || L["Eligibility Begin Date"] || null,
      insuranceType: snap?.insuranceType || null,
      planProduct: snap?.planProduct || null,
      coverageLevel: snap?.coverageLevel || null,
    },
    coverage: {
      statusText: chip || null,
      isActive,
      benefitLine: snap?.benefitLine || null,
      networkFilterUi: snap?.networkFilterUi || null,
    },
    planMaximums: {
      annualDeductible: snap?.annualDeductibleRow || null,
      outOfPocket: snap?.outOfPocketRow || null,
    },
    benefitCategories: snap?.benefitCategories || [],
    labels: L,
    parseHints: snap?.parseHints || {},
  };
}

export async function availityParseResponseSnapshot(frame, logger) {
  const expandedPlanMaximumsAccordion =
    await availityExpandHealthBenefitPlanCoverageIfCollapsed(frame, logger);
  const benefitAccordionExpand =
    await availityExpandAllBenefitAccordions(frame, logger);
  const snap = await frame.evaluate(() => {
    /** @type {Record<string, string>} */
    const labels = {};
    const card = document.querySelector("#patient-card");

    const mergeLabel = (k, v) => {
      if (!k || v == null || String(v).trim() === "") return;
      const key = String(k).replace(/:\s*$/, "").trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(labels, key)) return;
      labels[key] = String(v).trim();
    };

    const normalizeText = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const parsePlanDetailLi = (li) => {
      const left = li.querySelector("span.text-left, .text-left");
      const right = li.querySelector("span.text-right, .text-right");
      if (left && right) {
        const strongL = left.querySelector("strong");
        const k = normalizeText((strongL || left).innerText).replace(/:\s*$/, "");
        const strongR = right.querySelector("strong");
        const v = normalizeText((strongR || right).innerText);
        if (k && v) return { key: k, value: v };
      }

      const liText = normalizeText(li.innerText);
      const colonPair = liText.match(/^(.+?):\s*(.+)$/);
      if (colonPair) {
        const k = colonPair[1].trim();
        const v = colonPair[2].trim();
        if (k && v && k !== v) return { key: k, value: v };
      }

      const labelEl = li.querySelector(".MuiTypography-body1");
      if (labelEl) {
        const k = normalizeText(labelEl.innerText).replace(/:\s*$/, "");
        const valueEl = [...li.querySelectorAll(".MuiTypography-body2")].find(
          (el) =>
            !el.contains(labelEl) &&
            normalizeText(el.innerText) !== normalizeText(labelEl.innerText),
        );
        const v = valueEl ? normalizeText(valueEl.innerText) : "";
        if (k && v) return { key: k, value: v };
      }

      return null;
    };

    const parseStrongLabelSpans = (root) => {
      if (!root) return;
      root.querySelectorAll("span").forEach((span) => {
        const strong = span.querySelector(":scope > strong");
        if (!strong) return;
        const label = normalizeText(strong.innerText).replace(/:\s*$/, "");
        const full = normalizeText(span.innerText);
        if (!label || !full) return;
        const value = full
          .replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "i"), "")
          .trim();
        if (value) mergeLabel(label, value);
      });
    };

    const parseMuiCaptionPairDivs = (root) => {
      if (!root) return;
      root.querySelectorAll("div").forEach((div) => {
        const caps = [...div.children].filter(
          (c) =>
            c.tagName === "SPAN" &&
            /MuiTypography-caption/i.test(c.className || ""),
        );
        if (caps.length < 2) return;
        const k = normalizeText(caps[0].innerText).replace(/:\s*$/, "");
        const v = normalizeText(caps[caps.length - 1].innerText);
        if (k && v && k !== v) mergeLabel(k, v);
      });
    };

    const planList = document.querySelector("#plan-details-summary");
    const planDateList = document.querySelector("ul.plan-date-information");
    for (const ul of [planList, planDateList].filter(Boolean)) {
      ul.querySelectorAll("li").forEach((li) => {
        const pair = parsePlanDetailLi(li);
        if (pair) mergeLabel(pair.key, pair.value);
      });
    }

    parseStrongLabelSpans(document.body);

    const extRoot = card || document.body;
    extRoot.querySelectorAll(".patient-card-extended-label").forEach((el) => {
      const sp = el.querySelector("span");
      const sm = el.querySelector("small");
      if (!sp || !sm) return;
      const k = normalizeText(sp.innerText).replace(/:\s*$/, "");
      const v = normalizeText(sm.innerText);
      if (k) mergeLabel(k, v);
    });

    if (card) {
      parseMuiCaptionPairDivs(card);
      parseStrongLabelSpans(card);

      card
        .querySelectorAll(".d-flex .p-1, .d-flex .mr-auto, .d-flex > div")
        .forEach((cell) => {
          const smalls = [...cell.querySelectorAll("small")];
          if (smalls.length < 2) return;
          const k = normalizeText(smalls[0].innerText).replace(/:\s*$/, "");
          const v = normalizeText(smalls[smalls.length - 1].innerText);
          if (!k || !v || k === v) return;
          if (/^(date of service|transaction|customer|payer|dob|member id)/i.test(k))
            mergeLabel(k, v);
        });

      const pickAdjacentSmall = (re) => {
        const nodes = [...card.querySelectorAll("small")];
        const idx = nodes.findIndex((s) => re.test(s.innerText));
        if (idx === -1) return;
        const label = normalizeText(nodes[idx].innerText).replace(/:\s*$/, "");
        const next = nodes[idx + 1];
        if (next && next.tagName === "SMALL")
          mergeLabel(label, normalizeText(next.innerText));
      };
      pickAdjacentSmall(/date of service/i);
      pickAdjacentSmall(/transaction id/i);
      pickAdjacentSmall(/transaction time/i);
      pickAdjacentSmall(/customer id/i);
    }

    if (!labels["Transaction Date"]) {
      const txSpan = [...document.querySelectorAll("span")].find((s) =>
        /transaction date/i.test(s.innerText),
      );
      if (txSpan) {
        const strong = txSpan.querySelector(":scope > strong");
        if (strong) {
          const full = normalizeText(txSpan.innerText);
          const label = normalizeText(strong.innerText).replace(/:\s*$/, "");
          const value = full
            .replace(new RegExp(`^${label}:\\s*`, "i"), "")
            .trim();
          if (value) labels["Transaction Date"] = value;
        } else {
          const sib = txSpan.nextElementSibling;
          if (sib && sib.tagName === "SMALL")
            labels["Transaction Date"] = normalizeText(sib.innerText);
        }
      }
    }

    let chipText = "";
    if (card) {
      const scoped =
        card.querySelector("#patient-summary .MuiChip-label") ||
        card.querySelector(".MuiChip-label");
      chipText = scoped ? scoped.innerText.trim() : "";
    }
    if (!chipText) {
      const chip = document.querySelector(".MuiChip-label");
      chipText = chip ? chip.innerText.trim() : "";
    }

    const planScope =
      card?.closest("header")?.parentElement ||
      document.querySelector("main") ||
      document.body;
    const ps = [...planScope.querySelectorAll("p")];
    const spanAfter = (p) => {
      if (!p) return "";
      const spans = [...p.querySelectorAll("span")]
        .map((s) => normalizeText(s.innerText))
        .filter(Boolean);
      if (spans.length >= 2) {
        const value = spans[spans.length - 1];
        const label = spans[0];
        if (value && value !== label && !/:\s*$/.test(value)) return value;
      }
      const full = normalizeText(p.innerText);
      const m = full.match(/^[^:]+:\s*(.+)$/);
      return m ? m[1].trim() : "";
    };
    const planP = ps.find((p) => /\bPlan\s*\/\s*Product\b/i.test(p.innerText));
    let planProduct = spanAfter(planP);
    const insP = ps.find((p) => /\bInsurance Type\b/i.test(p.innerText));
    let insuranceType = spanAfter(insP);
    const levP = ps.find(
      (p) =>
        /\bCoverage Level\b/i.test(p.innerText) && /:\s*/.test(p.innerText),
    );
    let coverageLevel = spanAfter(levP);
    if (!coverageLevel) {
      const levLoose = ps.find((p) => /\bCoverage Level\b/i.test(p.innerText));
      coverageLevel = spanAfter(levLoose);
    }

    let patientNameOnFile = "";
    if (card) {
      const nameEl =
        card.querySelector("#patient-summary h1") ||
        card.querySelector("#patient-summary .MuiTypography-h2") ||
        card.querySelector("h1.MuiTypography-h2") ||
        card.querySelector("#patient-summary p.h4") ||
        card.querySelector("p.h4");
      patientNameOnFile = nameEl ? normalizeText(nameEl.innerText) : "";
    }
    if (!patientNameOnFile) {
      const summary = document.querySelector("#patient-summary");
      const h4s = summary && summary.querySelector("p.h4");
      patientNameOnFile = h4s ? h4s.innerText.trim() : "";
    }
    if (!patientNameOnFile) {
      const looksLikeMemberIdOnly = (s) => {
        const t = String(s || "").trim();
        if (t.length < 6 || t.length > 32) return false;
        if (/,/.test(t)) return false;
        return /^[A-Z0-9-]+$/i.test(t) && /\d/.test(t);
      };
      const lastCommaFirst = (s) =>
        /[A-Za-z][A-Za-z'\-\s]{1,50},\s*[A-Za-z][A-Za-z'\-\s]{1,50}/.test(
          String(s),
        );
      const candidates = [
        document.querySelector(".list-group-item-heading p.h4"),
        document.querySelector("header p.h4"),
        ...document.querySelectorAll("main p.h4"),
      ].filter(Boolean);
      for (const el of candidates) {
        const t = el.innerText.replace(/\s+/g, " ").trim();
        if (!t || looksLikeMemberIdOnly(t)) continue;
        if (lastCommaFirst(t)) {
          patientNameOnFile = t;
          break;
        }
      }
    }

    let benefitLine = "";
    if (card) {
      const benefitSmall = card.querySelector(".list-group-item div small");
      benefitLine = benefitSmall ? benefitSmall.innerText.trim() : "";
    }

    const alert = document.querySelector(".MuiAlert-message");
    const alertText = alert ? alert.innerText.trim() : "";

    /** @param {string | null | undefined} s */
    const parseMoney = (s) => {
      if (s == null) return null;
      const t = String(s)
        .replace(/\u2212/g, "-")
        .replace(/,/g, "")
        .replace(/[^0-9.-]/g, "");
      const m = t.match(/-?\d+(?:\.\d{2})?|-?\d+/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };

    const tableScope = document.body;

    /** Global "FILTER BY NETWORK" toggle (All / In / Out) when present */
    let networkFilterUi = null;
    const filterP = [...document.querySelectorAll("p")].find((p) =>
      /FILTER BY NETWORK/i.test(p.textContent || ""),
    );
    if (filterP) {
      const scope =
        filterP.closest(".MuiGrid-container") || filterP.parentElement;
      if (scope) {
        const pressed = scope.querySelector(
          'button[aria-pressed="true"][value]',
        );
        networkFilterUi = pressed
          ? pressed.getAttribute("value")?.trim() || null
          : null;
      }
    }

    const normalizeLine = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    /**
     * Plan Maximums rows (Annual Deductible, Out Of Pocket): network chip + $ total / YTD / remaining.
     */
    let annualDeductibleRow = null;
    let outOfPocketRow = null;
    const collectDetailText = (lastCell) => {
      if (!lastCell) return "";
      const fromPs = [...lastCell.querySelectorAll("p")]
        .map((p) =>
          (p.innerText || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (fromPs) return fromPs;
      return (lastCell.innerText || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };
    const tables = [
      ...tableScope.querySelectorAll("table.MuiTable-root"),
      ...tableScope.querySelectorAll("table[class*='MuiTable-root']"),
      ...tableScope.querySelectorAll("table"),
    ];
    const seenTables = new Set();
    for (const table of tables) {
      if (!table || seenTables.has(table)) continue;
      seenTables.add(table);
      const bodyRows = [...table.querySelectorAll("tr")].filter(
        (tr) => tr.querySelectorAll("td").length >= 3,
      );
      for (const tr of bodyRows) {
        const tds = [...tr.querySelectorAll("td")];
        if (tds.length < 3) continue;
        const firstTd = tds[0];
        const labelFromCell = (firstTd?.innerText || firstTd?.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const labelFromStrong = (() => {
          const st = firstTd?.querySelector("strong");
          if (!st) return "";
          return (st.innerText || st.textContent || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        })();
        const rowLabel = labelFromStrong || labelFromCell;
        const isAnnualDeductible = /\bannual\s+deductible\b/i.test(rowLabel);
        const isOutOfPocket = /\bout\s+of\s+pocket\b/i.test(rowLabel);
        if (!isAnnualDeductible && !isOutOfPocket) continue;

        const midCell = tds[1];
        let network = null;
        const chipEl = midCell?.querySelector(".MuiChip-label");
        if (chipEl)
          network = chipEl.innerText.replace(/\s+/g, " ").trim() || null;
        if (!network) {
          const midText = (midCell?.innerText || "").replace(/\s+/g, " ");
          const nm = midText.match(
            /\b(In Network|Out of Network|All Networks)\b/i,
          );
          if (nm) network = nm[1].replace(/\s+/g, " ");
        }

        const lastCell = tds[tds.length - 1];
        const detailText = collectDetailText(lastCell);
        const totalM = detailText.match(
          /\$[\d,]+(?:\.\d{2})?\s*\/\s*Calendar Year/i,
        );
        const totalAmount = totalM ? parseMoney(totalM[0]) : null;
        const remM = detailText.match(/\$[\d,]+(?:\.\d{2})?\s*Remaining/i);
        const ytdNegM =
          detailText.match(/-\$[\d,]+(?:\.\d{2})?\s*Year to Date/i) ||
          detailText.match(/\u2212\$[\d,]+(?:\.\d{2})?\s*Year to Date/i);
        const ytdPosM = detailText.match(
          /\$[\d,]+(?:\.\d{2})?\s*Year to Date/i,
        );
        const ytdSigned = ytdNegM
          ? parseMoney(ytdNegM[0])
          : ytdPosM
            ? parseMoney(ytdPosM[0])
            : null;
        const metAmount =
          ytdSigned != null && Number.isFinite(ytdSigned)
            ? Math.abs(ytdSigned)
            : null;
        let remainingAmount = remM ? parseMoney(remM[0]) : null;
        if (
          remainingAmount == null &&
          totalAmount != null &&
          metAmount != null
        ) {
          remainingAmount = Math.max(0, totalAmount - metAmount);
        }

        const hasMoneySignals =
          /Calendar Year/i.test(detailText) ||
          /Year to Date/i.test(detailText) ||
          /Remaining/i.test(detailText);
        if (!hasMoneySignals && totalAmount == null && metAmount == null) {
          continue;
        }

        const parsed = {
          label: rowLabel,
          network,
          totalAmount,
          metAmount,
          remainingAmount,
          totalText: totalM ? totalM[0].trim() : null,
          ytdText: ytdNegM
            ? ytdNegM[0].trim().replace(/\s+/g, " ")
            : ytdPosM
              ? ytdPosM[0].trim().replace(/\s+/g, " ")
              : null,
          remainingText: remM ? remM[0].trim().replace(/\s+/g, " ") : null,
        };
        if (isAnnualDeductible && !annualDeductibleRow)
          annualDeductibleRow = parsed;
        if (isOutOfPocket && !outOfPocketRow) outOfPocketRow = parsed;
        if (annualDeductibleRow && outOfPocketRow) break;
      }
      if (annualDeductibleRow && outOfPocketRow) break;
    }

    if (annualDeductibleRow) {
      if (annualDeductibleRow.network)
        mergeLabel("Annual deductible (network)", annualDeductibleRow.network);
      if (annualDeductibleRow.totalText)
        mergeLabel(
          "Annual deductible (total)",
          String(annualDeductibleRow.totalAmount),
        );
      if (annualDeductibleRow.metAmount != null)
        mergeLabel(
          "Annual deductible (met / YTD)",
          String(annualDeductibleRow.metAmount),
        );
      if (annualDeductibleRow.remainingAmount != null)
        mergeLabel(
          "Annual deductible (remaining)",
          String(annualDeductibleRow.remainingAmount),
        );
    }
    if (outOfPocketRow) {
      if (outOfPocketRow.network)
        mergeLabel("Out of pocket (network)", outOfPocketRow.network);
      if (outOfPocketRow.totalAmount != null)
        mergeLabel("Out of pocket (total)", String(outOfPocketRow.totalAmount));
      if (outOfPocketRow.metAmount != null)
        mergeLabel("Out of pocket (met / YTD)", String(outOfPocketRow.metAmount));
      if (outOfPocketRow.remainingAmount != null)
        mergeLabel(
          "Out of pocket (remaining)",
          String(outOfPocketRow.remainingAmount),
        );
    }
    if (networkFilterUi)
      mergeLabel("Network filter (UI)", networkFilterUi);

    const isLikelyServiceDescription = (description) => {
      const d = normalizeLine(description);
      if (d.length < 8 || d.length > 160) return false;
      if (/^refer to:/i.test(d)) return false;
      if (/^(remaining|calendar year|\$)/i.test(d)) return false;
      if (/COPAY MAX/i.test(d)) return false;
      if (/\d+\s*Remaining/i.test(d) && !/visit|evaluation|surgery|care|room|lab|xray/i.test(d))
        return false;
      return /visit|evaluation|surgery|care|room|lab|xray|chiropractor|emergency|urgent|telemedicine|gyn|specialist|primary|physician|confinement|ancillary|clinic/i.test(
        d,
      );
    };

    const parseServiceRowsFromSection = (sectionRoot) => {
      /** @type {Array<{ description: string, copay: number | null, copayText: string | null, coinsurancePercent: number | null, notes: string | null }>} */
      const services = [];
      const seen = new Set();
      if (!sectionRoot) return services;

      for (const tr of sectionRoot.querySelectorAll("tr")) {
        const line = normalizeLine(tr.innerText || tr.textContent || "");
        if (line.length < 12) continue;
        if (
          /\bannual\s+deductible\b/i.test(line) &&
          /calendar year/i.test(line)
        )
          continue;
        if (/\bout\s+of\s+pocket\b/i.test(line) && /calendar year/i.test(line))
          continue;
        if (/COPAY MAX/i.test(line) && !/visit|evaluation|surgery/i.test(line))
          continue;

        const serviceChunks = line.split(
          /(?=[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*\s+(?:Visit|Evaluation|Surgery|Care|Room|Lab|Xray|Chiropractor|Physician|Clinic|Services))/,
        );

        for (const chunk of serviceChunks.length > 1 ? serviceChunks : [line]) {
          for (const m of chunk.matchAll(
            /([A-Za-z][A-Za-z0-9\s,()\/\-]{4,120}?)(?:,COPAY[^—$]{0,80})?\s*—\s*\$(\d+(?:\.\d{2})?)/gi,
          )) {
            const description = m[1]
              .trim()
              .replace(/^(?:iders|oviders)\s+/i, "")
              .replace(/,\s*$/, "")
              .replace(/\s+/g, " ");
            if (!isLikelyServiceDescription(description)) continue;
            const copayText = `$${m[2]}`;
            const copay = parseMoney(copayText);
            const key = `${description}|${copayText}`;
            if (seen.has(key)) continue;
            seen.add(key);
            services.push({
              description,
              copay,
              copayText,
              coinsurancePercent: null,
              notes: /COPAY NOT INCLUDED IN OOP/i.test(chunk)
                ? "COPAY NOT INCLUDED IN OOP"
                : null,
            });
          }

          for (const m of chunk.matchAll(
            /([A-Za-z][A-Za-z0-9\s,()\/\-]{4,120}?),COINS[^%]{0,100}(\d{1,3})%/gi,
          )) {
            const description = m[1]
              .trim()
              .replace(/^(?:iders|oviders)\s+/i, "")
              .replace(/\s+/g, " ");
            if (!isLikelyServiceDescription(description)) continue;
            const coinsurancePercent = Number(m[2]);
            const key = `${description}|coins|${coinsurancePercent}`;
            if (seen.has(key)) continue;
            seen.add(key);
            services.push({
              description,
              copay: null,
              copayText: null,
              coinsurancePercent: Number.isFinite(coinsurancePercent)
                ? coinsurancePercent
                : null,
              notes: "COINS APPLIES TO OUT OF POCKET",
            });
          }
        }
      }
      return services;
    };

    const summarizeServices = (services) => {
      const copays = [
        ...new Set(
          services
            .map((s) => s.copay)
            .filter((n) => n != null && Number.isFinite(n)),
        ),
      ].sort((a, b) => a - b);
      const coinsurancePercents = [
        ...new Set(
          services
            .map((s) => s.coinsurancePercent)
            .filter((n) => n != null && Number.isFinite(n)),
        ),
      ].sort((a, b) => a - b);
      return { copays, coinsurancePercents };
    };

    /** @type {Array<object>} */
    const benefitCategories = [];
    const accordionButtons = [...document.querySelectorAll("button")].filter(
      (btn) =>
        [...btn.querySelectorAll("span")].some((s) =>
          /^\s*-\s*\d{1,3}\s*$/.test(s.textContent || ""),
        ),
    );

    for (const btn of accordionButtons) {
      const codeSpan = [...btn.querySelectorAll("span")].find((s) =>
        /^\s*-\s*(\d{1,3})\s*$/.test(s.textContent || ""),
      );
      const stcCode = codeSpan
        ? (codeSpan.textContent || "").replace(/\D/g, "").trim()
        : null;

      let name = normalizeLine(btn.innerText || btn.textContent || "");
      if (stcCode) name = name.replace(new RegExp(`\\s*-\\s*${stcCode}\\s*$`), "").trim();

      const card = btn.closest(".MuiCard-root");
      const collapse = card?.querySelector(".MuiCollapse-root");
      const sectionRoot = collapse || card;
      const services = parseServiceRowsFromSection(sectionRoot);
      const summary = summarizeServices(services);

      /** @type {object | null} */
      let planMaximums = null;
      if (/health benefit plan coverage/i.test(name)) {
        planMaximums = {
          annualDeductible: annualDeductibleRow,
          outOfPocket: outOfPocketRow,
        };
      }

      benefitCategories.push({
        name,
        stcCode,
        planMaximums,
        services,
        summary,
      });
    }

    const patientCard = {
      memberId: labels["Member ID"] || labels["Subscriber ID"] || null,
      payerId: labels["Payer ID"] || null,
      dob: labels["DOB"] || labels["Date of Birth"] || null,
      dateOfService: labels["Date of Service"] || null,
      transactionDate: labels["Transaction Date"] || null,
      transactionTime: labels["Transaction Time"] || null,
      transactionId: labels["Transaction ID"] || null,
      customerId: labels["Customer ID"] || null,
    };

    const plan = {
      memberId: labels["Member ID"] || labels["Subscriber ID"] || null,
      groupNumber: labels["Group Number"] || null,
      groupName: labels["Group Name"] || null,
      planNumber: labels["Plan Number"] || null,
      planBeginDate: labels["Plan Begin Date"] || null,
      eligibilityBeginDate: labels["Eligibility Begin Date"] || null,
    };

    return {
      labels,
      chipText,
      planProduct,
      insuranceType,
      coverageLevel,
      patientNameOnFile,
      patientCard,
      plan,
      benefitLine,
      alertText,
      networkFilterUi,
      annualDeductibleRow,
      outOfPocketRow,
      benefitCategories,
      parseHints: {
        hadPatientCard: Boolean(card),
        hadPlanDetailsSummary: Boolean(planList),
        hadPlanDateInformation: Boolean(planDateList),
        parseIncomplete: !card && !planList,
        hadAnnualDeductibleTableRow: Boolean(annualDeductibleRow),
        hadOutOfPocketTableRow: Boolean(outOfPocketRow),
        benefitCategoryCount: benefitCategories.length,
      },
    };
  });
  if (snap && snap.parseHints) {
    snap.parseHints.expandedPlanMaximumsAccordion =
      expandedPlanMaximumsAccordion;
    snap.parseHints.expandedBenefitAccordions = benefitAccordionExpand.expanded;
    snap.parseHints.benefitAccordionTotal = benefitAccordionExpand.total;
  }
  return snap;
}

function looksLikePayerMemberIdToken(s) {
  const t = String(s || "").trim();
  if (t.length < 6 || t.length > 36) return false;
  if (/,/.test(t)) return false;
  return /^[A-Z0-9-]+$/i.test(t) && /\d/.test(t);
}

export function validateEligibilitySnapshotOrThrow(snap) {
  if (snap.alertText) throw new Error(snap.alertText);
  const L = snap.labels || {};
  const mid = String(L["Member ID"] || L["Subscriber ID"] || "").trim();
  if (snap.parseHints?.parseIncomplete && !mid) {
    throw new Error(
      "Availity eligibility result summary did not render in time",
    );
  }
}

/** @param {object} snap */
export function buildBenefitServiceRowsFromSnap(snap) {
  /** @type {Array<object>} */
  const rows = [];
  for (const cat of snap?.benefitCategories || []) {
    const services = cat?.services || [];
    if (!services.length) continue;
    const benefitCategoryName = String(cat.name || "").trim() || "Unknown";
    const stcCode = cat.stcCode != null ? String(cat.stcCode).trim() : null;
    for (const svc of services) {
      const serviceDescription = String(svc?.description || "").trim();
      if (!serviceDescription) continue;
      const copayAmount =
        svc.copay != null && Number.isFinite(Number(svc.copay))
          ? Number(svc.copay)
          : null;
      const coinsurancePercent =
        svc.coinsurancePercent != null &&
        Number.isFinite(Number(svc.coinsurancePercent))
          ? Number(svc.coinsurancePercent)
          : null;
      rows.push({
        benefitCategoryName,
        stcCode: stcCode || null,
        serviceDescription,
        copayAmount,
        copayText: svc.copayText || null,
        coinsurancePercent,
        notes: svc.notes || null,
      });
    }
  }
  return rows;
}

/**
 * DB insert bundle: normalized result row, per-service rows, and review JSON payload (same shape as *-benefits.json).
 * @param {object} snap
 * @param {{ benefitsJsonPath?: string | null }} [meta]
 */
export function buildAvailityDbBundle(snap, meta = {}) {
  const mapped = mapAvailitySnapshotToResultRow(snap);
  const benefitsPayload = buildEligibilityBenefitsPayload(snap);
  return {
    result: {
      coverageStatusText: mapped.coverageStatusText,
      isActive: mapped.isActive,
      memberId: mapped.memberId,
      payerId: mapped.payerId,
      patientNameOnFile: mapped.patientNameOnFile,
      dateOfBirth:
        mapped.dateOfBirth ||
        snap?.patientCard?.dob ||
        snap?.labels?.DOB ||
        null,
      dateOfService: mapped.dateOfService,
      transactionDate: mapped.transactionDate,
      transactionTime: mapped.transactionTime,
      transactionId: mapped.transactionId,
      customerId:
        mapped.customerId ||
        snap?.patientCard?.customerId ||
        snap?.labels?.["Customer ID"] ||
        null,
      insuranceType: mapped.insuranceType,
      planProduct: mapped.planProduct,
      coverageLevel: mapped.coverageLevel,
      groupNumber: mapped.groupNumber,
      groupName: mapped.groupName,
      planNumber: mapped.planNumber,
      planBeginDate: mapped.planBeginDate,
      eligibilityBeginDate: mapped.eligibilityBeginDate,
      annualDeductibleNetwork: mapped.annualDeductibleNetwork,
      annualDeductibleTotal: mapped.annualDeductibleTotal,
      annualDeductibleMet: mapped.annualDeductibleMet,
      annualDeductibleRemaining: mapped.annualDeductibleRemaining,
      oopNetwork: mapped.outOfPocketNetwork,
      oopTotal: mapped.outOfPocketTotal,
      oopMet: mapped.outOfPocketMet,
      oopRemaining: mapped.outOfPocketRemaining,
      benefitsJsonPath: meta.benefitsJsonPath || null,
    },
    benefitServices: buildBenefitServiceRowsFromSnap(snap),
    benefitsPayload,
  };
}

export function mapAvailitySnapshotToResultRow(snap) {
  const L = snap.labels || {};
  const memberId = L["Member ID"] || L["Subscriber ID"] || "";
  const payerId = L["Payer ID"] || "";
  const pc = snap.patientCard || {};
  const plan = snap.plan || {};
  const dateOfService = pc.dateOfService || L["Date of Service"] || "";
  const transactionDate = pc.transactionDate || L["Transaction Date"] || "";
  const transactionTime = pc.transactionTime || L["Transaction Time"] || "";
  const transactionId = pc.transactionId || L["Transaction ID"] || "";
  const customerId = pc.customerId || L["Customer ID"] || "";
  const dob = pc.dob || L["DOB"] || L["Date of Birth"] || "";
  const chip = snap.chipText || "";
  const isActive =
    /active coverage/i.test(chip) && !/inactive|not eligible/i.test(chip);

  let patientNameOnFile = snap.patientNameOnFile || null;
  if (
    patientNameOnFile &&
    (patientNameOnFile === memberId ||
      looksLikePayerMemberIdToken(patientNameOnFile))
  ) {
    patientNameOnFile = null;
  }

  const ad = snap.annualDeductibleRow || null;
  const oop = snap.outOfPocketRow || null;
  return {
    coverageStatusText: chip || null,
    isActive,
    memberId: memberId || null,
    payerId: payerId || null,
    patientNameOnFile,
    benefitLine: snap.benefitLine || null,
    dateOfBirth: dob || null,
    dateOfService: dateOfService || null,
    transactionDate: transactionDate || null,
    transactionTime: transactionTime || null,
    transactionId: transactionId || null,
    customerId: customerId || null,
    groupNumber: plan.groupNumber || L["Group Number"] || null,
    groupName: plan.groupName || L["Group Name"] || null,
    planNumber: plan.planNumber || L["Plan Number"] || null,
    planBeginDate: plan.planBeginDate || L["Plan Begin Date"] || null,
    eligibilityBeginDate:
      plan.eligibilityBeginDate || L["Eligibility Begin Date"] || null,
    insuranceType: snap.insuranceType || null,
    planProduct: snap.planProduct || null,
    coverageLevel: snap.coverageLevel || null,
    annualDeductibleNetwork: ad?.network ?? null,
    annualDeductibleTotal: ad?.totalAmount ?? null,
    annualDeductibleMet: ad?.metAmount ?? null,
    annualDeductibleRemaining: ad?.remainingAmount ?? null,
    outOfPocketNetwork: oop?.network ?? null,
    outOfPocketTotal: oop?.totalAmount ?? null,
    outOfPocketMet: oop?.metAmount ?? null,
    outOfPocketRemaining: oop?.remainingAmount ?? null,
    benefitCategories: snap.benefitCategories || [],
    networkFilterUi: snap.networkFilterUi || null,
    rawSnapshot: snap,
  };
}
