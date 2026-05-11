const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function asText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeToken(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toUsDate(isoDate) {
  const s = String(isoDate || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

async function clickFirstVisible(frameOrPage, selectors, timeoutMs = 5000) {
  for (const selector of selectors) {
    const locator = frameOrPage.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      await locator.click({ timeout: timeoutMs });
      return true;
    }
  }
  return false;
}

async function fillFirstVisible(frameOrPage, selectors, value, timeoutMs = 5000) {
  for (const selector of selectors) {
    const locator = frameOrPage.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      await locator.fill(String(value || ""), { timeout: timeoutMs });
      return true;
    }
  }
  return false;
}

async function clearAndType(locator, value) {
  await locator.click({ timeout: 5000 });
  await locator.fill("", { timeout: 5000 }).catch(() => {});
  await locator.type(String(value || ""), { delay: 15, timeout: 10000 }).catch(async () => {
    await locator.fill(String(value || ""), { timeout: 10000 });
  });
}

function assertRequiredValue(value, fieldName) {
  const v = asText(value);
  if (!v) {
    throw new Error(`Claim status missing required data for ${fieldName}`);
  }
  return v;
}

async function fillAndVerifyRequiredText(scope, selectors, value, fieldName) {
  const required = assertRequiredValue(value, fieldName);
  for (const selector of selectors) {
    const input = scope.locator(selector).first();
    if (!(await input.isVisible({ timeout: 2000 }).catch(() => false))) continue;
    await clearAndType(input, required);
    await input.press("Tab").catch(() => {});
    const current = asText(await input.inputValue().catch(() => ""));
    if (!current) {
      throw new Error(`Claim status failed to set ${fieldName} using selector ${selector}`);
    }
    return;
  }
  throw new Error(`Claim status required input not found for ${fieldName}`);
}

async function selectReactValue(frame, inputSelector, value, optionRegex) {
  const input = frame.locator(inputSelector).first();
  if (!(await input.isVisible({ timeout: 4000 }).catch(() => false))) return false;
  await clearAndType(input, value);
  await sleep(600);
  const option = frame
    .locator("[id*='react-select'][id*='option'], [role='option']")
    .filter({ hasText: optionRegex || value })
    .first();
  if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
    await option.click({ timeout: 8000 });
  } else {
    await input.press("Enter").catch(() => {});
  }
  return true;
}

async function forceSelectReactValue(frame, inputSelector, query, expectedRegex) {
  const input = frame.locator(inputSelector).first();
  if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error(`Claim status select input not visible: ${inputSelector}`);
  }

  await input.click({ timeout: 5000 });
  await input.press("Control+A").catch(() => {});
  await input.press("Backspace").catch(() => {});
  await clearAndType(input, query);
  await sleep(800);

  const menuOption = frame
    .locator(
      "[role='option'], .organization-select__option, .provider-select__option, [id*='react-select'][id*='option']",
    )
    .filter({ hasText: expectedRegex || query })
    .first();

  if (await menuOption.isVisible({ timeout: 4000 }).catch(() => false)) {
    await menuOption.click({ timeout: 10000 });
  } else {
    // Fallback when list isn't surfaced but control supports keyboard select.
    await input.press("ArrowDown").catch(() => {});
    await input.press("Enter").catch(() => {});
  }
  await sleep(500);
}

async function providerLooksSelected(frame) {
  const selectedValue = frame.locator(
    ".provider-select__single-value, #providerSelect .provider-select__single-value, #providerExpressEntry + div .provider-select__single-value",
  ).first();
  const selectedText = asText(await selectedValue.textContent().catch(() => ""));
  if (/open mind/i.test(selectedText)) return true;
  const providerNpiInput = frame.locator("input#providerNpi").first();
  if (await providerNpiInput.isVisible({ timeout: 800 }).catch(() => false)) {
    const npiVal = asText(await providerNpiInput.inputValue().catch(() => ""));
    if (npiVal) return true;
  }
  return false;
}

async function forceSelectProviderOpenMind(frame, providerQuery) {
  const query = providerQuery || "OPEN MIND MENTAL HEALTH PHYSICIANS";
  const input = frame.locator("input#providerExpressEntry").first();
  if (!(await input.isVisible({ timeout: 6000 }).catch(() => false))) {
    throw new Error("Provider input not visible: #providerExpressEntry");
  }

  // Open react-select dropdown explicitly.
  const dropdownArrow = frame
    .locator(
      "#providerSelect .provider-select__dropdown-indicator, #providerSelect .provider-select__control",
    )
    .first();
  if (await dropdownArrow.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dropdownArrow.click({ timeout: 5000 }).catch(() => {});
  }

  // Type query to filter options.
  await input.click({ timeout: 5000 });
  await input.press("Control+A").catch(() => {});
  await input.press("Backspace").catch(() => {});
  await clearAndType(input, query);
  await sleep(900);

  // Prefer provider-specific option classes/id patterns from your DOM (react-select-4).
  const option = frame
    .locator(
      "#providerSelect [id^='react-select-4-option-'], .provider-select__menu [role='option'], .provider-select__option, [id^='react-select-4-option-']",
    )
    .filter({ hasText: /open mind/i })
    .first();

  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click({ timeout: 10000 });
  } else {
    // Keyboard fallback if menu is rendered differently.
    await input.press("ArrowDown").catch(() => {});
    await input.press("Enter").catch(() => {});
  }
  await sleep(700);
  return providerLooksSelected(frame);
}

async function organizationLooksSelected(frame) {
  const selectedValue = frame
    .locator(
      ".organization-select__single-value, #orgSelect .organization-select__single-value",
    )
    .first();
  const selectedText = asText(await selectedValue.textContent().catch(() => ""));
  if (/open mind health/i.test(selectedText)) return true;
  const hiddenOrg = frame.locator("input[name='organization']").first();
  const hiddenVal = asText(await hiddenOrg.inputValue().catch(() => ""));
  return Boolean(hiddenVal);
}

async function getAvailityContentFrame(page, frameSelector) {
  const selector = String(frameSelector || "iframe#newBodyFrame");
  const frameEl = page.locator(selector).first();
  await frameEl.waitFor({ state: "visible", timeout: 120000 });
  const handle = await frameEl.elementHandle();
  if (!handle) throw new Error("Availity claim status iframe handle not found");
  const frame = await handle.contentFrame();
  await handle.dispose().catch(() => {});
  if (!frame) throw new Error("Availity claim status iframe content frame unavailable");
  return frame;
}

async function pageHasClaimForm(scope) {
  const hasOrg = await scope
    .locator("input#organization")
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  const hasPayer = await scope
    .locator("input#payer")
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  return hasOrg || hasPayer;
}

async function openClaimStatusApp(page, config, logger) {
  const url = String(config?.availity?.claimStatusAppUrl || "").trim();
  if (!url) {
    throw new Error("Availity claim status URL is not configured");
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  // Some tenants open claim-status as a direct app page (no iframe shell),
  // while others render it inside navigation iframe.
  if (await pageHasClaimForm(page)) {
    logger?.info?.("Availity claim status app opened (direct page mode)");
    return page;
  }
  const frame = await getAvailityContentFrame(page, config?.availity?.contentFrameSelector);
  await frame.waitForLoadState("domcontentloaded", { timeout: 120000 }).catch(() => {});
  logger?.info?.("Availity claim status app opened (iframe mode)");
  return frame;
}

async function isClaimStatusFormVisible(page, frameSelector) {
  // Direct page mode
  if (await pageHasClaimForm(page)) return true;

  // Iframe mode
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
  return pageHasClaimForm(frame);
}

async function fillClaimStatusForm(frame, claimRow, config) {
  const payerName = assertRequiredValue(claimRow.payer_name, "payer");
  const memberId = assertRequiredValue(claimRow.member_id, "member_id");
  const lastName = assertRequiredValue(claimRow.last_name, "patient_last_name");
  const firstName = assertRequiredValue(claimRow.first_name, "patient_first_name");
  const dobUs = assertRequiredValue(toUsDate(claimRow.date_of_birth), "patient_dob");
  const fromUs = assertRequiredValue(toUsDate(claimRow.service_start_date), "service_start_date");
  const toUs = assertRequiredValue(toUsDate(claimRow.service_end_date), "service_end_date");

  await frame.locator("#organization, #payer").first().waitFor({ state: "visible", timeout: 30000 });
  await forceSelectReactValue(
    frame,
    "input#organization",
    config.availity.organizationQuery || "Open Mind Health",
    /open mind health/i,
  );
  if (!(await organizationLooksSelected(frame))) {
    throw new Error("Claim status required organization selection could not be applied");
  }
  await selectReactValue(frame, "input#payer", payerName, payerName);

  await clickFirstVisible(frame, ["#providerOrgName-yes"], 5000);
  let providerSelected = await providerLooksSelected(frame);
  if (!providerSelected) {
    providerSelected = await forceSelectProviderOpenMind(
      frame,
      config.availity.providerQuery || "OPEN MIND MENTAL HEALTH PHYSICIANS",
    );
  }
  if (!providerSelected) {
    throw new Error("Claim status provider selection failed (#providerExpressEntry still not selected)");
  }
  // Provider details (NPI/etc.) should auto-populate from selected provider.
  // Do not hard-fail on provider NPI visibility because some tenant layouts hide
  // the input once provider is selected.
  const providerNpiInput = frame.locator("input#providerNpi").first();
  if (await providerNpiInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    const npiVal = asText(await providerNpiInput.inputValue().catch(() => ""));
    if (!npiVal) {
      await fillFirstVisible(frame, ["input#providerNpi"], "1093454423");
    }
  }

  // Patient + subscriber-as-patient mode.
  await fillAndVerifyRequiredText(frame, ["input#patientMemberId"], memberId, "patient_member_id");
  await fillAndVerifyRequiredText(frame, ["input#patientLastName"], lastName, "patient_last_name");
  await fillAndVerifyRequiredText(frame, ["input#patientFirstName"], firstName, "patient_first_name");
  await fillAndVerifyRequiredText(frame, ["input#patientBirthDate"], dobUs, "patient_birth_date");
  const subscriberSameCheckbox = frame.locator("input#patientIsSubscriber-18").first();
  if (!(await subscriberSameCheckbox.isVisible({ timeout: 4000 }).catch(() => false))) {
    throw new Error("Claim status required checkbox not found: patientIsSubscriber-18");
  }
  if (!(await subscriberSameCheckbox.isChecked().catch(() => false))) {
    await subscriberSameCheckbox.check({ timeout: 5000 }).catch(async () => {
      await subscriberSameCheckbox.click({ timeout: 5000 });
    });
  }
  if (!(await subscriberSameCheckbox.isChecked().catch(() => false))) {
    throw new Error("Claim status failed to set subscriber-is-patient checkbox");
  }

  // Service date range in the claim section.
  await fillAndVerifyRequiredText(frame, ["input#serviceDates-start"], fromUs, "service_date_start");
  await fillAndVerifyRequiredText(frame, ["input#serviceDates-end"], toUs, "service_date_end");
}

async function submitClaimStatusSearch(frame) {
  const clicked = await clickFirstVisible(
    frame,
    [
      "button:has-text('Submit')",
      "button:has-text('Search')",
      "button#submit-by276",
      "button[type='submit']",
      "input[type='submit']",
    ],
    12000,
  );
  if (!clicked) {
    throw new Error("Claim status submit/search button not found");
  }
  await sleep(2500);
}

async function waitForClaimResultsReady(frame, timeoutMs = 120000) {
  const startedAt = Date.now();
  const resultsRoot = frame.locator("#results").first();
  await resultsRoot.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 30000) });

  // Wait until block-ui loading layer clears (aria-busy true -> false/hidden).
  while (Date.now() - startedAt < timeoutMs) {
    const loadingVisible = await frame
      .locator("#results .block-ui[aria-busy='true'], #results [aria-busy='true'] .loading-indicator")
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (!loadingVisible) {
      // small settle to allow rows to render after spinner disappears
      await sleep(600);
      return;
    }
    await sleep(1000);
  }
  throw new Error("Claim status results did not finish loading in time");
}

/**
 * Paid status is rendered differently across Availity builds (badge classes, grid cells).
 * Availity often uses uppercase "PAID"; avoid overly strict ^…$ matching on innerText.
 */
async function isPaidClaimRow(row) {
  const badgePaid = await row
    .locator(".badge.badge-success, .badge-success, [class*='badge-success']")
    .filter({ hasText: /paid/i })
    .first()
    .isVisible({ timeout: 600 })
    .catch(() => false);
  if (badgePaid) return true;
  return await row
    .locator(".badge")
    .filter({ hasText: /paid/i })
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);
}

/** Claim # column in HIPAA results table (0-based: Status, Finalized, Service, Claim #, …). */
async function extractClaimNumberFromResultRow(row) {
  const cells = row.locator("td[role='cell']");
  const n = await cells.count().catch(() => 0);
  if (n >= 4) {
    return asText(await cells.nth(3).innerText().catch(() => ""));
  }
  return "";
}

/**
 * One remittance download target: prefer stable payer claim id when present.
 */
async function collectPaidRemittanceTargets(frame) {
  const rows = frame.locator("#claimsTable tbody tr");
  const total = await rows.count().catch(() => 0);
  const byFingerprint = new Map();
  const byClaimKey = new Map();
  const targets = [];
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    if (!(await isPaidClaimRow(row))) continue;
    const fingerprint = asText(await row.innerText().catch(() => ""));
    const claimKey = await extractClaimNumberFromResultRow(row);
    let sameFingerprintOrdinal = 0;
    if (claimKey) {
      sameFingerprintOrdinal = byClaimKey.get(claimKey) || 0;
      byClaimKey.set(claimKey, sameFingerprintOrdinal + 1);
    } else {
      sameFingerprintOrdinal = byFingerprint.get(fingerprint) || 0;
      byFingerprint.set(fingerprint, sameFingerprintOrdinal + 1);
    }
    targets.push({ claimKey, fingerprint, sameFingerprintOrdinal, domIndex: i });
  }
  return targets;
}

async function clickPaidRowByClaimKey(frame, claimKey, ordinalForDupes) {
  const target = asText(claimKey);
  if (!target) {
    throw new Error("clickPaidRowByClaimKey: empty claim key");
  }
  const rows = frame.locator("#claimsTable tbody tr");
  const total = await rows.count().catch(() => 0);
  let seen = 0;
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    if (!(await isPaidClaimRow(row))) continue;
    const k = await extractClaimNumberFromResultRow(row);
    if (asText(k) !== target) continue;
    if (seen !== ordinalForDupes) {
      seen += 1;
      continue;
    }
    const text = asText(await row.innerText().catch(() => ""));
    const firstCell = row.locator("td.cursor-pointer, td[role='cell']").first();
    if (await firstCell.isVisible({ timeout: 1200 }).catch(() => false)) {
      await firstCell.click({ timeout: 15000 });
    } else {
      await row.click({ timeout: 15000 });
    }
    await sleep(2200);
    return text;
  }
  throw new Error(`Paid row for claim # "${target}" not found (ordinal=${ordinalForDupes})`);
}

async function clickPaidRemittanceTarget(frame, target) {
  if (asText(target.claimKey)) {
    return clickPaidRowByClaimKey(frame, target.claimKey, target.sameFingerprintOrdinal);
  }
  return clickPaidRowSnapshot(frame, {
    fingerprint: target.fingerprint,
    sameFingerprintOrdinal: target.sameFingerprintOrdinal,
  });
}

async function claimResultsRowCount(frame) {
  return frame.locator("#claimsTable tbody tr").count().catch(() => 0);
}

async function waitForClaimResultsRowCountAtLeast(frame, minRows, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const n = await claimResultsRowCount(frame);
    if (n >= minRows) return n;
    await sleep(350);
  }
  return claimResultsRowCount(frame);
}

async function countPaidRows(frame) {
  const candidates = frame.locator("#claimsTable tbody tr");
  const total = await candidates.count().catch(() => 0);
  let paidCount = 0;
  for (let i = 0; i < total; i += 1) {
    const row = candidates.nth(i);
    if (await isPaidClaimRow(row)) paidCount += 1;
  }
  return paidCount;
}

async function clickPaidRowSnapshot(frame, { fingerprint, sameFingerprintOrdinal }) {
  const target = asText(fingerprint);
  const rows = frame.locator("#claimsTable tbody tr");
  const total = await rows.count().catch(() => 0);
  let seenForPrint = 0;
  for (let i = 0; i < total; i += 1) {
    const row = rows.nth(i);
    if (!(await isPaidClaimRow(row))) continue;
    const text = asText(await row.innerText().catch(() => ""));
    if (text !== target) continue;
    if (seenForPrint !== sameFingerprintOrdinal) {
      seenForPrint += 1;
      continue;
    }
    const firstCell = row.locator("td.cursor-pointer, td[role='cell']").first();
    if (await firstCell.isVisible({ timeout: 1200 }).catch(() => false)) {
      await firstCell.click({ timeout: 15000 });
    } else {
      await row.click({ timeout: 15000 });
    }
    await sleep(2200);
    return text;
  }
  throw new Error(
    `Paid row not found for snapshot (ordinal=${sameFingerprintOrdinal}, len=${target.length})`,
  );
}

/**
 * Re-attach to the claim-status UI after navigation (iframe reloads / remittance tab closes).
 */
async function resolveClaimStatusUiFrame(page, config, logger) {
  if (await pageHasClaimForm(page)) {
    logger?.info?.("Claim status scope: direct page");
    return page;
  }
  const fr = await getAvailityContentFrame(page, config?.availity?.contentFrameSelector);
  logger?.info?.("Claim status scope: content iframe");
  return fr;
}

/**
 * Saves a full-page screenshot and HTML snapshot(s) under ./debug/.
 * @param {'frame' | 'page' | 'both'} [htmlFrom='frame'] - `both` captures frame vs top-level page (helps when popovers mount on document.body).
 * @returns {{ screenshotPath: string, htmlPaths: string[] }}
 */
async function captureClaimStatusDebugArtifacts({
  page,
  frame,
  claimRow,
  tag,
  htmlFrom = "frame",
  logger,
}) {
  const dir = path.resolve(process.cwd(), "debug");
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const patientToken = sanitizeToken(claimRow?.pm_patient_id || claimRow?.patient_id);
  const safeTag = sanitizeToken(tag || "claim-status");

  const screenshotPath = path.join(
    dir,
    `availity-claim-${safeTag}-${patientToken}-${ts}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

  const htmlPaths = [];
  const writeHtml = (suffix, content) => {
    if (!content) return;
    const name = suffix
      ? `availity-claim-${safeTag}-${patientToken}-${ts}-${suffix}.html`
      : `availity-claim-${safeTag}-${patientToken}-${ts}.html`;
    const htmlPath = path.join(dir, name);
    fs.writeFileSync(htmlPath, content, "utf8");
    htmlPaths.push(htmlPath);
  };

  if (htmlFrom === "both") {
    const fc = await frame.content().catch(() => "");
    const pc = await page.content().catch(() => "");
    if (fc && pc && fc === pc) {
      writeHtml(null, fc);
    } else {
      writeHtml("frame", fc);
      writeHtml("page", pc);
    }
  } else if (htmlFrom === "page") {
    writeHtml(null, await page.content().catch(() => ""));
  } else {
    writeHtml(null, await frame.content().catch(() => ""));
  }

  const msg = `[sync] claim-status debug: screenshot=${screenshotPath} html=${htmlPaths.join(", ")}`;
  logger?.info?.(msg);

  return { screenshotPath, htmlPaths };
}

async function waitForRemittanceDownloadPopoverVisible(page, frame, timeoutMs = 25000) {
  const started = Date.now();
  const remitDownloadsUiSeen = async (scope) => {
    // Do NOT match generic [role='dialog'] — Pendo onboarding uses role="dialog" and fooled the old wait:
    // we exited before the Bootstrap popover / modal existed, so frame.content() never contained "All Pages".
    const byTitle = scope
      .getByText(/Payer-Issued Remittance Advice Downloads\s*:?\s*/i)
      .first();
    if (await byTitle.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const byAllPagesTxt = scope.getByText(/All Pages\s*\(\s*\d+\s*Downloads\s*\)/i).first();
    if (await byAllPagesTxt.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const byAllPagesShort = scope.getByText(/^All Pages/i).first();
    if (await byAllPagesShort.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const allPagesInput = scope.locator("input[id^='allclaimeob'], input[id*='allclaimeob' i]").first();
    if (await allPagesInput.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const bootstrapPopover = scope
      .locator(".popover.show, .popover.fade.show, [class*='bs-popover']")
      .filter({ hasText: /All Pages|Payer-Issued Remittance Advice Downloads/i })
      .first();
    if (await bootstrapPopover.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const remitModal = scope
      .locator(".modal.show")
      .filter({ hasText: /All Pages|Payer-Issued Remittance Advice Downloads|Download\s*[12]/i })
      .first();
    if (await remitModal.isVisible({ timeout: 400 }).catch(() => false)) return true;

    const dlInShell = await scope
      .locator(".popover.show button:has-text('Download'), .modal.show button:has-text('Download')")
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    const remitCtxTxt = await scope
      .getByText(/All Pages|Payer-Issued Remittance Advice/i)
      .first()
      .isVisible({ timeout: 400 })
      .catch(() => false);
    return dlInShell && remitCtxTxt;
  };

  while (Date.now() - started < timeoutMs) {
    for (const scope of [frame, page]) {
      if (await remitDownloadsUiSeen(scope)) return true;
    }
    await sleep(250);
  }
  return false;
}

async function waitForRemittanceAction(page, frame, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frameBtnVisible = await frame
      .locator(
        "button#remitViewerButton[aria-label='Open Remit Viewer'], button#remitViewerButton",
      )
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (frameBtnVisible) return "frame";

    const pageBtnVisible = await page
      .locator(
        "button#remitViewerButton[aria-label='Open Remit Viewer'], button#remitViewerButton",
      )
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (pageBtnVisible) return "page";

    // Wait for any busy state to clear while details screen loads.
    const busy = await frame
      .locator("[aria-busy='true'], .block-ui[aria-busy='true']")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    await sleep(busy ? 1200 : 800);
  }
  return null;
}

async function clickRemittance(claimDetailsPage, frame) {
  await claimDetailsPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await claimDetailsPage.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const where = await waitForRemittanceAction(claimDetailsPage, frame, 45000);
  if (!where) {
    throw new Error("Remittance action did not appear after opening claim details");
  }
  const ctx = claimDetailsPage.context();
  const newPagePromise = ctx.waitForEvent("page", { timeout: 25000 }).catch(() => null);
  const clickedInFrame = await clickFirstVisible(
    frame,
    [
      "button#remitViewerButton[aria-label='Open Remit Viewer']",
      "button#remitViewerButton",
    ],
    20000,
  );
  if (clickedInFrame) {
    await sleep(2800);
  } else {
    const clickedInPage = await clickFirstVisible(
      claimDetailsPage,
      [
        "button#remitViewerButton[aria-label='Open Remit Viewer']",
        "button#remitViewerButton",
      ],
      20000,
    );
    if (!clickedInPage) {
      throw new Error("Remittance action not found on claim details page");
    }
    await sleep(2800);
  }

  const maybeNewPage = await newPagePromise;
  const remitPage = maybeNewPage || claimDetailsPage;
  if (maybeNewPage) {
    await maybeNewPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await maybeNewPage.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  }
  return { remitPage, claimDetailsPage };
}

function orderedFrames(remitPage) {
  const main = remitPage.mainFrame();
  const rest = remitPage.frames().filter((f) => f !== main);
  return [main, ...rest];
}

function tabsDebugEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.AVAILITY_CLAIM_STATUS_DEBUG_TABS || "").toLowerCase(),
  );
}

/** Log every open tab URL (set AVAILITY_CLAIM_STATUS_DEBUG_TABS=1). */
async function logOpenTabs(context, logger, label) {
  if (!tabsDebugEnabled() || !logger?.info) return;
  const pages = context.pages();
  const lines = await Promise.all(
    pages.map(async (p, i) => {
      let u = "(url unavailable)";
      try {
        u = p.url();
      } catch {
        /* detached */
      }
      return `  [${i}] ${u}`;
    }),
  );
  logger.info(`[sync] claim-status tabs (${label}) count=${pages.length}\n${lines.join("\n")}`);
}

/**
 * Basenames of *.pdf in dir (excludes .crdownload).
 */
async function listPdfBasenamesInDir(dir) {
  const s = new Set();
  try {
    const arr = await fs.promises.readdir(dir);
    for (const n of arr) {
      if (/\.pdf$/i.test(n) && !/\.crdownload$/i.test(n)) s.add(n);
    }
  } catch {
    /* dir missing until mkdir elsewhere */
  }
  return s;
}

/**
 * Chrome/CDP may write the PDF straight to the download folder with no Playwright "download" event
 * and no capturable application/pdf response (SPA / nested frame). Pick newest matching file.
 */
async function scanOnceForNewPdfOnDisk(downloadDir, namesBeforeClick, clickStartedAt, logger) {
  let entries;
  try {
    entries = await fs.promises.readdir(downloadDir);
  } catch {
    return null;
  }
  let best = null;
  let bestMtime = 0;
  for (const name of entries) {
    if (!/\.pdf$/i.test(name)) continue;
    if (/\.crdownload$/i.test(name)) continue;
    const full = path.join(downloadDir, name);
    const st = await fs.promises.stat(full).catch(() => null);
    if (!st || st.size < 500) continue;
    const isNewName = !namesBeforeClick.has(name);
    const isFreshMtime = st.mtimeMs >= clickStartedAt - 10_000;
    if (!(isNewName || isFreshMtime)) continue;
    if (st.mtimeMs >= bestMtime) {
      bestMtime = st.mtimeMs;
      best = { diskPath: full, fileName: name, size: st.size };
    }
  }
  if (best) {
    logger?.info?.(
      `[sync] claim-status: disk PDF candidate file=${best.fileName} bytes=${best.size} mtime=${bestMtime}`,
    );
  }
  return best;
}

async function waitForPdfFileStable(filePath, minBytes, settleMs) {
  let last = -1;
  const deadline = Date.now() + Math.max(2000, settleMs);
  while (Date.now() < deadline) {
    const st = await fs.promises.stat(filePath).catch(() => null);
    if (!st) {
      await sleep(200);
      continue;
    }
    if (st.size >= minBytes && st.size === last) return true;
    last = st.size;
    await sleep(350);
  }
  const st = await fs.promises.stat(filePath).catch(() => null);
  return Boolean(st && st.size >= minBytes);
}

/**
 * Availity may: (1) Playwright download event, (2) application/pdf response, (3) Chrome writing straight to downloadDir (CDP).
 * `triggerClick` runs after listeners are attached.
 */
async function waitForRemittancePdfAsset(context, timeoutMs, logger, triggerClick, downloadDir) {
  let pdfBytes = null;
  let pdfUrl = null;

  /** @param {import('playwright').Response} response */
  async function onResponse(response) {
    const ct = (response.headers()["content-type"] || "").toLowerCase();
    const url = response.url() || "";
    const pathOnly = (url.split("?")[0] || "").toLowerCase();
    const looksPdfUrl = /\.pdf($|[?#])/i.test(pathOnly);
    const looksPdf =
      ct.includes("application/pdf") ||
      (ct.includes("octet-stream") && looksPdfUrl) ||
      (ct.includes("binary") && looksPdfUrl);
    if (!looksPdf) return;
    if (response.status() < 200 || response.status() >= 400) return;
    try {
      const buf = await response.body();
      if (!buf || buf.length < 400) return;
      pdfBytes = buf;
      pdfUrl = response.url();
      logger?.info?.(
        `[sync] claim-status: saw application/pdf response (${buf.length} bytes) url=${(pdfUrl || "").slice(0, 160)}`,
      );
    } catch {
      /* ignore */
    }
  }

  context.on("response", onResponse);
  const started = Date.now();
  const dir = String(downloadDir || "").trim();
  let namesBeforeClick = new Set();
  if (dir) {
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
    namesBeforeClick = await listPdfBasenamesInDir(dir);
  }
  const clickStartedAt = Date.now();

  try {
    if (typeof triggerClick === "function") {
      await triggerClick();
    }

    while (Date.now() - started < timeoutMs) {
      const slice = Math.min(3000, Math.max(400, timeoutMs - (Date.now() - started)));
      try {
        const download = await context.waitForEvent("download", { timeout: slice });
        return { download, buffer: null, url: null, diskPath: null, fileName: null };
      } catch {
        /* continue */
      }
      if (pdfBytes) {
        return { download: null, buffer: pdfBytes, url: pdfUrl, diskPath: null, fileName: null };
      }
      if (dir) {
        const cand = await scanOnceForNewPdfOnDisk(dir, namesBeforeClick, clickStartedAt, logger);
        if (cand && (await waitForPdfFileStable(cand.diskPath, 500, 8000))) {
          return {
            download: null,
            buffer: null,
            url: null,
            diskPath: cand.diskPath,
            fileName: cand.fileName,
          };
        }
      }
    }
    if (pdfBytes) {
      return { download: null, buffer: pdfBytes, url: pdfUrl, diskPath: null, fileName: null };
    }
    throw new Error(
      `No Playwright download, no application/pdf response, and no new PDF file in ${dir || "(no dir)"} within ${timeoutMs}ms`,
    );
  } finally {
    context.removeListener("response", onResponse);
  }
}

function suggestedPdfNameFromUrl(url) {
  try {
    const base = path.basename(new URL(url).pathname || "");
    if (base && /\.pdf$/i.test(base)) return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Waits until the Remittance Viewer UI is usable on **remitPage** (this tab only).
 * - We never query the Claim Status iframe from the other flow (avoids wrong `{ frame: claimFrame }`).
 * - We **do** scan every frame on `remitPage` (main + child iframes): the viewer often mounts inside
 *   an iframe, and `page.locator()` only hits the main frame.
 */
async function waitForRemitTableReady(remitPage, timeoutMs = 90000) {
  const started = Date.now();
  const selectors = [
    "div[role='table'][aria-label='Remits']",
    "div[role='table'][aria-label*='Remit' i]",
    "button[id^='claimeob']",
    "button[aria-label*='Remittance Advice' i]",
    "button[aria-label*='Download Claim Payer-Issued' i]",
    "button[aria-label*='Payer-Issued Remittance' i]",
    "button:has(.icon-file-pdf)",
    "text=Payments issued from",
    "text=Download CSV",
    "text=Check/EFT",
  ];
  while (Date.now() - started < timeoutMs) {
    for (const fr of orderedFrames(remitPage)) {
      for (const sel of selectors) {
        const visible = await fr
          .locator(sel)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);
        if (visible) {
          return { page: remitPage, frame: fr };
        }
      }
    }

    await sleep(900);
  }
  throw new Error("Remittance table did not appear in time after clicking viewer");
}

async function scopesForPdfClick(page, frame) {
  const out = [];
  if (frame) out.push(frame);
  if (page && page !== frame) out.push(page);
  return out;
}

/**
 * Bootstrap custom-control: `.custom-control-label` overlays `#allclaimeobN`; click its label with `force:true` first.
 */
async function ensureAllPagesRemitOptionChecked(inputLocator, frame, page) {
  const checked = async () => Boolean(await inputLocator.isChecked().catch(() => false));
  if (await checked()) return;

  const scopes = await scopesForPdfClick(page, frame);
  const id = String(await inputLocator.getAttribute("id").catch(() => "") || "").replace(/[\"'<>]/g, "");
  if (id) {
    for (const scope of scopes) {
      const lbl = scope
        .locator(`label.custom-control-label[for="${id}"], label[for="${id}"]`)
        .filter({ hasText: /All Pages/i })
        .first();
      if (!(await lbl.isVisible({ timeout: 2000 }).catch(() => false))) continue;
      await lbl.click({ timeout: 15000, force: true }).catch(async () => {
        await scope.locator(`label[for="${id}"]`).first().click({ timeout: 15000, force: true });
      });
      await sleep(260);
      if (await checked()) return;
    }
  }

  await inputLocator.check({ force: true, timeout: 15000 }).catch(() => {});
  await sleep(220);
  if (await checked()) return;

  await inputLocator.click({ force: true, timeout: 15000 }).catch(() => {});
  await sleep(220);
  if (await checked()) return;

  await inputLocator.evaluate((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    el.checked = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function clickRemittancePopoverDownloadButton(frame, page) {
  const scopes = await scopesForPdfClick(page, frame);
  const selectors = [
    ".popover.show button.btn-primary:has-text('Download'), .popover.fade.show button.btn-primary:has-text('Download')",
    ".popover button.btn-primary:has-text('Download')",
    ".modal.show button.btn-primary:has-text('Download')",
    "button.btn-primary.btn-sm:has-text('Download')",
  ];
  for (const scope of scopes) {
    for (const sel of selectors) {
      const btn = scope.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sleep(200);
        await btn.click({ timeout: 20000, force: true });
        return true;
      }
    }
  }
  return false;
}

/**
 * Remittance viewer is usually one claim per tab: PDF control is often `#claimeob0` even when
 * `paidIndex` is 1 on the claim-status results table. Try paidIndex first, then 0, then any visible.
 */
async function resolveVisibleClaimeobPdfButton(scopes, paidIndex, logger) {
  const tryId = async (idNum) => {
    const sel = `#claimeob${idNum}`;
    for (const scope of scopes) {
      const candidate = scope.locator(`button${sel}`).first();
      if (await candidate.isVisible({ timeout: 2200 }).catch(() => false)) {
        logger?.info?.(`[sync] Remittance payer PDF button using ${sel}`);
        return candidate;
      }
    }
    return null;
  };

  let btn = await tryId(paidIndex);
  if (!btn && paidIndex !== 0) {
    btn = await tryId(0);
  }
  if (!btn) {
    for (const scope of scopes) {
      const loc = scope.locator("button[id^='claimeob']").first();
      if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
        const id = String(await loc.getAttribute("id").catch(() => "") || "");
        logger?.info?.(`[sync] Remittance payer PDF button fallback first visible id=${id}`);
        return loc;
      }
    }
  }
  return btn;
}

/**
 * Opens the payer-issued remittance downloads popover. The Actions column exposes a Bootstrap **tooltip**
 * ("PDF created by the payer"); a naive single click often only toggles that tooltip and never renders
 * `.popover` — debug HTML showed `bs-tooltip-auto` but no downloads UI.
 */
async function openPayerIssuedDownloadsPopover(page, frame, paidIndex, logger) {
  const scopes = await scopesForPdfClick(page, frame);
  const btn = await resolveVisibleClaimeobPdfButton(scopes, paidIndex, logger);
  if (!btn) {
    logger?.warn?.(
      `[sync] Remittance payer PDF button not visible for paidIndex=${paidIndex} (tried #claimeob${paidIndex}, #claimeob0, any button[id^='claimeob'])`,
    );
    await captureClaimStatusDebugArtifacts({
      page,
      frame,
      claimRow: { pm_patient_id: `paid-${paidIndex}` },
      tag: `error-remit-popup-not-found-${paidIndex}`,
      htmlFrom: "both",
      logger,
    });
    throw new Error(`Remittance popup button not found for paid index=${paidIndex}`);
  }

  await btn.scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => {});

  const attempts = [
    {
      label: "dismiss overlays + hover + single click",
      run: async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(160);
        await btn.hover({ timeout: 8000 }).catch(() => {});
        await sleep(140);
        await btn.click({ timeout: 15000, delay: 40 });
      },
    },
    {
      label: "double click",
      run: async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(140);
        await btn.click({ timeout: 15000, clickCount: 2, delay: 60 });
      },
    },
    {
      label: "focus + Enter",
      run: async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(140);
        await btn.focus({ timeout: 8000 }).catch(() => {});
        await page.keyboard.press("Enter");
      },
    },
    {
      label: "force click after hover-off",
      run: async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await sleep(140);
        await page.mouse.move(0, 0).catch(() => {});
        await sleep(220);
        await btn.click({ timeout: 15000, force: true });
      },
    },
  ];

  for (let i = 0; i < attempts.length; i += 1) {
    logger?.info?.(`[sync] Remittance payer PDF click attempt=${i + 1}/${attempts.length} (${attempts[i].label})`);
    await attempts[i].run().catch((e) =>
      logger?.warn?.(`[sync] Remittance payer PDF attempt failed: ${e?.message || e}`),
    );
    if (await waitForRemittanceDownloadPopoverVisible(page, frame, 14000)) {
      return;
    }
    await sleep(400);
  }

  logger?.warn?.(
    `[sync] Remittance downloads popover never appeared after ${attempts.length} click strategies`,
  );
  await captureClaimStatusDebugArtifacts({
    page,
    frame,
    claimRow: { pm_patient_id: `paid-${paidIndex}` },
    tag: `error-remit-download-popover-open-${paidIndex}`,
    htmlFrom: "both",
    logger,
  });
  throw new Error(
    `Payer-Issued Remittance downloads popover did not open for paid index=${paidIndex} (only tooltip or no overlay)`,
  );
}

async function downloadRemittancePdf(page, frame, downloadDir, paidIndex, logger) {
  fs.mkdirSync(downloadDir, { recursive: true });

  await openPayerIssuedDownloadsPopover(page, frame, paidIndex, logger);
  await sleep(500);
  await captureClaimStatusDebugArtifacts({
    page,
    frame,
    claimRow: { pm_patient_id: `paid-${paidIndex}` },
    tag: `after-remit-pdf-btn-click-paid-${paidIndex}`,
    htmlFrom: "both",
    logger,
  });

  const waitForAllPagesControl = async (timeoutMs = 45000) => {
    const checkboxSelectors = [
      `#allclaimeob${paidIndex}`,
      `#allclaimeob0`,
      "input[id^='allclaimeob']",
      "input[id*='allclaimeob' i]",
      "input[id*='AllClaimEob' i]",
      "input[name^='allclaimeob']",
      "input[name*='allclaimeob' i]",
    ];
    /** Bootstrap popover or modal containing the payer remittance downloads form (omit generic [role=dialog] — Pendo). */
    const remittanceDownloadsShell = (scope) =>
      scope
        .locator(".popover.show, .popover.fade.show, [class*='bs-popover'], .modal.show")
        .filter({
          hasText: /Payer-Issued Remittance Advice Downloads|All Pages\s*\(\s*\d+\s*Downloads/i,
        })
        .first();

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const scopes = [frame, page];
      for (const scope of scopes) {
        const shell = remittanceDownloadsShell(scope);
        if (await shell.isVisible({ timeout: 500 }).catch(() => false)) {
          for (const role of ["checkbox", "radio"]) {
            const byRole = shell.getByRole(role, { name: /all\s*pages/i }).first();
            if (await byRole.isVisible({ timeout: 700 }).catch(() => false)) {
              return byRole;
            }
            const byRoleDownloads = shell
              .getByRole(role, { name: /all\s*pages\s*\(.*downloads\)/i })
              .first();
            if (await byRoleDownloads.isVisible({ timeout: 700 }).catch(() => false)) {
              return byRoleDownloads;
            }
          }
          const formRow = shell
            .locator(".form-check, .custom-control, .custom-radio, label.form-check-label")
            .filter({ hasText: /^All Pages/i })
            .first();
          const inputInRow = formRow.locator("input[type='checkbox'], input[type='radio']").first();
          if (await inputInRow.isVisible({ timeout: 700 }).catch(() => false)) {
            return inputInRow;
          }
          const siblingInput = shell
            .locator(".form-check, .custom-radio, .custom-control")
            .filter({ hasText: /^All Pages/i })
            .locator("input")
            .first();
          if (await siblingInput.isVisible({ timeout: 700 }).catch(() => false)) {
            return siblingInput;
          }
          for (const sel of checkboxSelectors) {
            const scoped = shell.locator(sel).first();
            if (await scoped.isVisible({ timeout: 700 }).catch(() => false)) {
              return scoped;
            }
          }
        }

        const byLabel = scope.getByLabel(/all\s*pages/i).first();
        if (await byLabel.isVisible({ timeout: 400 }).catch(() => false)) {
          return byLabel;
        }
        const byRole = scope.getByRole("checkbox", { name: /all\s*pages/i }).first();
        if (await byRole.isVisible({ timeout: 400 }).catch(() => false)) {
          return byRole;
        }
        const byRadio = scope.getByRole("radio", { name: /all\s*pages/i }).first();
        if (await byRadio.isVisible({ timeout: 400 }).catch(() => false)) {
          return byRadio;
        }
        const byRoleDownloadsSuffix = scope
          .getByRole("checkbox", { name: /all\s*pages\s*\(.*downloads\)/i })
          .first();
        if (await byRoleDownloadsSuffix.isVisible({ timeout: 400 }).catch(() => false)) {
          return byRoleDownloadsSuffix;
        }
        const byRadioDownloadsSuffix = scope
          .getByRole("radio", { name: /all\s*pages\s*\(.*downloads\)/i })
          .first();
        if (await byRadioDownloadsSuffix.isVisible({ timeout: 400 }).catch(() => false)) {
          return byRadioDownloadsSuffix;
        }
        const byRoleLoose = scope.getByRole("checkbox", { name: /all.*page/i }).first();
        if (await byRoleLoose.isVisible({ timeout: 400 }).catch(() => false)) {
          return byRoleLoose;
        }
        for (const sel of checkboxSelectors) {
          const loc = scope.locator(sel).first();
          if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
            return loc;
          }
        }

        const popOnly = scope.locator(".popover.show, .popover.fade.show").first();
        if (await popOnly.isVisible({ timeout: 400 }).catch(() => false)) {
          const innerCb = popOnly.locator("input[type='checkbox'], input[type='radio']").first();
          if (await innerCb.isVisible({ timeout: 600 }).catch(() => false)) {
            return innerCb;
          }
          const roleCb = popOnly.locator("[role='checkbox']").first();
          if (await roleCb.isVisible({ timeout: 600 }).catch(() => false)) {
            return roleCb;
          }
        }
      }
      await sleep(350);
    }
    return null;
  };

  const allPagesCheckbox = await waitForAllPagesControl(45000);
  if (!allPagesCheckbox) {
    await captureClaimStatusDebugArtifacts({
      page,
      frame,
      claimRow: { pm_patient_id: `paid-${paidIndex}` },
      tag: `error-all-pages-not-found-${paidIndex}`,
      htmlFrom: "both",
      logger,
    });
    throw new Error(`All Pages checkbox not found for paid index=${paidIndex}`);
  }
  await sleep(250);
  await ensureAllPagesRemitOptionChecked(allPagesCheckbox, frame, page);

  const ctx = page.context();
  await logOpenTabs(ctx, logger, "before remittance Download click");
  logger?.info?.(
    "[sync] claim-status: waiting for Playwright download, PDF HTTP response, or new .pdf in download dir (up to 120s)",
  );

  const asset = await waitForRemittancePdfAsset(ctx, 120000, logger, async () => {
    const clickDownloadOk =
      (await clickRemittancePopoverDownloadButton(frame, page)) ||
      (await clickFirstVisible(frame, ["button.btn-primary.btn-sm:has-text('Download')"], 12000)) ||
      (await clickFirstVisible(page, ["button.btn-primary.btn-sm:has-text('Download')"], 12000));
    if (!clickDownloadOk) {
      await captureClaimStatusDebugArtifacts({
        page,
        frame,
        claimRow: { pm_patient_id: `paid-${paidIndex}` },
        tag: `error-download-btn-not-found-${paidIndex}`,
      });
      throw new Error("Download button not found in remittance popover");
    }
  }, downloadDir);

  const ts = Date.now();
  let safeName;
  let savedAt;

  if (asset.download) {
    const suggestedName = asset.download.suggestedFilename() || `remittance-${ts}.pdf`;
    safeName = suggestedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    savedAt = path.join(downloadDir, `${ts}-${safeName}`);
    await asset.download.saveAs(savedAt);
  } else if (asset.buffer) {
    safeName = suggestedPdfNameFromUrl(asset.url) || `remittance-${ts}.pdf`;
    savedAt = path.join(downloadDir, `${ts}-${safeName}`);
    fs.writeFileSync(savedAt, asset.buffer);
    logger?.info?.(`[sync] claim-status: saved PDF from HTTP body to ${savedAt}`);
  } else if (asset.diskPath && asset.fileName) {
    safeName = asset.fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    savedAt = path.resolve(asset.diskPath);
    logger?.info?.(
      `[sync] claim-status: using browser-written PDF on disk (no Playwright download event) path=${savedAt}`,
    );
  } else {
    throw new Error("Remittance PDF asset was empty after Download click");
  }

  await logOpenTabs(ctx, logger, "after remittance PDF saved");
  return { fileName: safeName, filePath: savedAt, downloadedAt: new Date().toISOString() };
}

async function resultsTableVisibleInScope(scope) {
  return scope
    .locator("#claimsTable tbody tr")
    .first()
    .isVisible({ timeout: 2500 })
    .catch(() => false);
}

/**
 * From #/hipaa-details?orgId=&payerId=&... jump to #/dashboard?orgId=&payerId= where the results table lives.
 */
async function navigateFromHipaaDetailsToDashboardResults(page, logger) {
  let url;
  try {
    url = page.url();
  } catch {
    return false;
  }
  if (!/#\/hipaa-details/i.test(url)) return false;
  try {
    const u = new URL(url);
    const rawHash = u.hash || "";
    const hashBody = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
    const qIdx = hashBody.indexOf("?");
    const qs = qIdx >= 0 ? new URLSearchParams(hashBody.slice(qIdx + 1)) : new URLSearchParams();
    const orgId = qs.get("orgId");
    const payerId = qs.get("payerId");
    if (!orgId || !payerId) {
      logger?.warn?.("[sync] claim-status: hipaa-details URL missing orgId/payerId for dashboard fallback");
      return false;
    }
    const targetHash = `#/dashboard?orgId=${encodeURIComponent(orgId)}&payerId=${encodeURIComponent(payerId)}`;
    const targetUrl = `${u.origin}${u.pathname}${targetHash}`;
    logger?.info?.(
      `[sync] claim-status: SPA fallback — goto dashboard results ${targetUrl.slice(0, 140)}…`,
    );
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 90000 }).catch(() => {});
    await sleep(2000);
    return true;
  } catch (e) {
    logger?.warn?.(`[sync] claim-status: dashboard goto fallback failed: ${e?.message || e}`);
    return false;
  }
}

const BACK_OR_RESULTS_NAV_SELECTORS = [
  "button:has-text('Back')",
  "a:has-text('Back')",
  "button:has-text('Return')",
  "a:has-text('Return')",
  "[aria-label='Back' i]",
  "[aria-label*='back to' i]",
  "[aria-label*='previous' i]",
  "button.btn-link:has(.icon-arrow-left)",
  "a.btn-link:has(.icon-arrow-left)",
  ".breadcrumb a[href*='#/dashboard']",
  "ol.breadcrumb a[href*='#/dashboard']",
  "a.breadcrumb-item[href*='dashboard']",
];

/**
 * After remittance (often a new browser tab), land on the results grid (#claimsTable) again.
 */
async function returnToClaimResults(page, frame, logger) {
  const scopes = frame === page ? [page] : [frame, page];

  const tryUiBack = async () => {
    for (const scope of scopes) {
      const clicked = await clickFirstVisible(scope, BACK_OR_RESULTS_NAV_SELECTORS, 5000);
      if (clicked) {
        await sleep(1800);
        return true;
      }
    }
    return false;
  };

  const tryBreadcrumbSearch = async () => {
    for (const scope of scopes) {
      const byRole = scope.getByRole("link", { name: /^search$/i }).first();
      if (await byRole.isVisible({ timeout: 1200 }).catch(() => false)) {
        await byRole.click({ timeout: 12000 }).catch(() => {});
        await sleep(2200);
        return true;
      }
      const dashSearch = scope
        .locator("ol.breadcrumb a[href*='#/dashboard'], .breadcrumb a[href*='#/dashboard']")
        .filter({ hasText: /^search$/i })
        .first();
      if (await dashSearch.isVisible({ timeout: 1200 }).catch(() => false)) {
        await dashSearch.click({ timeout: 12000 }).catch(() => {});
        await sleep(2200);
        return true;
      }
    }
    return false;
  };

  for (let round = 0; round < 8; round += 1) {
    await page.bringToFront().catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(200);

    for (const s of scopes) {
      await s.locator("#results").first().scrollIntoViewIfNeeded().catch(() => {});
      if (await resultsTableVisibleInScope(s)) return;
    }

    if (await tryUiBack()) {
      for (const s of scopes) {
        if (await resultsTableVisibleInScope(s)) return;
      }
    }

    if (await tryBreadcrumbSearch()) {
      for (const s of scopes) {
        if (await resultsTableVisibleInScope(s)) return;
      }
    }

    for (let g = 0; g < 2; g += 1) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
      await sleep(1600);
      for (const s of scopes) {
        if (await resultsTableVisibleInScope(s)) return;
      }
    }

    if (await navigateFromHipaaDetailsToDashboardResults(page, logger)) {
      if (await resultsTableVisibleInScope(page)) return;
    }
  }

  throw new Error(
    "Could not return to claim status results (#claimsTable) after remittance; try HEADLESS=false or check SPA hash routes",
  );
}

async function processPaidRemittancesForClaim({
  page,
  frame,
  claimRow,
  config,
  logger,
}) {
  const downloadDir = String(config?.availity?.claimStatusDownloadDir || "").trim();
  if (!downloadDir) throw new Error("Claim remittance download directory is not configured");
  await captureClaimStatusDebugArtifacts({
    page,
    frame,
    claimRow,
    tag: "after-submit",
  });
  let workFrame = await resolveClaimStatusUiFrame(page, config, logger);
  await waitForClaimResultsReady(workFrame);
  await captureClaimStatusDebugArtifacts({
    page,
    frame: workFrame,
    claimRow,
    tag: "after-loading",
  });
  const paidTargets = await collectPaidRemittanceTargets(workFrame);
  const paidCount = paidTargets.length;
  const initialResultsRowCount = await claimResultsRowCount(workFrame);
  await captureClaimStatusDebugArtifacts({
    page,
    frame: workFrame,
    claimRow,
    tag: `results-paid-${paidCount}`,
  });
  logger?.info?.(`Claim status results paid rows=${paidCount} patient=${claimRow.pm_patient_id}`);
  const downloads = [];
  for (let paidIndex = 0; paidIndex < paidCount; paidIndex += 1) {
    workFrame = await resolveClaimStatusUiFrame(page, config, logger);
    await waitForClaimResultsReady(workFrame);
    await page.bringToFront().catch(() => {});
    await workFrame.locator("#results").first().scrollIntoViewIfNeeded().catch(() => {});
    await waitForClaimResultsRowCountAtLeast(
      workFrame,
      Math.max(initialResultsRowCount, paidCount),
      30000,
    );
    const rowText = await clickPaidRemittanceTarget(workFrame, paidTargets[paidIndex]);
    await logOpenTabs(page.context(), logger, `after opening claim details paidIndex=${paidIndex}`);
    const { remitPage, claimDetailsPage } = await clickRemittance(page, workFrame);
    await logOpenTabs(page.context(), logger, `after remittance viewer open paidIndex=${paidIndex}`);
    let remitScope;
    try {
      remitScope = await waitForRemitTableReady(remitPage);
    } catch (err) {
      await captureClaimStatusDebugArtifacts({
        page: remitPage,
        frame: remitPage,
        claimRow: { pm_patient_id: `paid-${paidIndex}` },
        tag: `error-remit-table-timeout-${paidIndex}`,
      });
      throw err;
    }
    try {
      const file = await downloadRemittancePdf(
        remitScope.page,
        remitScope.frame,
        downloadDir,
        paidIndex,
        logger,
      );
      downloads.push({
        ...file,
        claimRowText: rowText,
      });
    } finally {
      if (remitPage && remitPage !== claimDetailsPage) {
        await remitPage.close().catch(() => {});
      }
      await claimDetailsPage.bringToFront().catch(() => {});
      await logOpenTabs(page.context(), logger, `after closing remit tab paidIndex=${paidIndex}`);
    }
    await returnToClaimResults(claimDetailsPage, workFrame, logger);
    await sleep(1500);
    workFrame = await resolveClaimStatusUiFrame(page, config, logger);
    await waitForClaimResultsReady(workFrame);
  }
  return downloads;
}

module.exports = {
  openClaimStatusApp,
  isClaimStatusFormVisible,
  fillClaimStatusForm,
  submitClaimStatusSearch,
  processPaidRemittancesForClaim,
};
