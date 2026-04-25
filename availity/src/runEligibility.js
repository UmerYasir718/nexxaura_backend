import * as insuranceQueueRepo from "./repos/insuranceQueueRepo.js";
import * as availityEligibilityRepo from "./repos/availityEligibilityRepo.js";
import * as av from "./eligibilityScraper.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAvailityInquiryError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("intermittent failures") ||
    (text.includes("eligibility and benefits inquiry") &&
      text.includes("claim status inquiry"))
  );
}

/**
 * @param {{
 *   config: ReturnType<import('./config.js').loadAvailityConfig>,
 *   logger: ReturnType<import('./logger.js').createLogger>,
 *   browser: ReturnType<import('./browser.js').createBrowser>,
 *   db: ReturnType<import('./db.js').createDatabase>,
 * }} ctx
 */
export async function runAvailityEligibility(ctx) {
  const { config, logger, browser, db } = ctx;
  const scraperCtx = { config, logger, browser };

  const limit = config.availity.maxPatientsPerRun;
  const rows = await insuranceQueueRepo.listPrimaryInsuranceForAvaility(
    db,
    limit,
  );
  if (!rows.length) {
    logger.warn(
      "No patients with primary insurance (member_id + payer_name + DOB). Run Office Ally sync first.",
    );
    return { processed: 0, successes: 0, failures: 0 };
  }

  logger.info(
    `Availity eligibility: ${rows.length} patient(s) queued (limit ${limit})`,
  );

  let successes = 0;
  let failures = 0;

  try {
    await browser.launch();
    await av.availityLogin(scraperCtx);
    await browser.screenshot("availity-after-login");

    for (const row of rows) {
      const patientPayload = {
        payerName: row.payer_name,
        memberId: row.member_id,
        patientDobIso: row.date_of_birth,
      };

      const runId = await availityEligibilityRepo.startAvailityRun(db, {
        patientId: row.patient_id,
        coverageRank: row.coverage_rank || 1,
        payerNameUsed: row.payer_name,
        memberIdUsed: row.member_id,
      });

      try {
        const maxAttempts = 2;
        let mapped = null;
        let lastErr = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            if (attempt > 1) {
              logger.warn(
                `Retrying Availity inquiry for pm_patient_id=${row.pm_patient_id} (attempt ${attempt}/${maxAttempts})`,
              );
            }

            await av.availityOpenEligibilityApp(scraperCtx);
            const frame = await av.availityGetContentFrame(scraperCtx);
            await frame
              .locator("#organization-field")
              .waitFor({ state: "visible", timeout: 90000 });

            await av.availityFillInquiryForm(scraperCtx, frame, patientPayload);
            await browser.screenshot(`availity-filled-${row.pm_patient_id}`);
            await av.availitySubmitInquiry(scraperCtx, frame);
            await av.availityWaitForResponse(scraperCtx, frame);
            if (config.availity.resultScreenDelayMs > 0) {
              logger.info(
                `Result screen delay ${config.availity.resultScreenDelayMs}ms for DOM study (pm_patient_id=${row.pm_patient_id})`,
              );
              await sleep(config.availity.resultScreenDelayMs);
            }

            const snap = await av.availityParseResponseSnapshot(frame);
            if (snap.alertText) {
              throw new Error(snap.alertText);
            }

            mapped = av.mapAvailitySnapshotToResultRow(snap);
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            const msg = e?.message || String(e);
            const canRetry =
              attempt < maxAttempts && isTransientAvailityInquiryError(msg);
            if (canRetry) {
              logger.warn(
                `Transient Availity inquiry error for pm_patient_id=${row.pm_patient_id}: ${msg}`,
              );
              continue;
            }
            throw e;
          }
        }

        if (!mapped && lastErr) throw lastErr;
        await availityEligibilityRepo.insertAvailityResult(db, runId, mapped);
        await availityEligibilityRepo.finishAvailityRun(
          db,
          runId,
          "success",
          null,
        );
        successes += 1;
        logger.info(
          `Availity OK pm_patient_id=${row.pm_patient_id} active=${mapped.isActive}`,
        );
        await browser.screenshot(`availity-result-${row.pm_patient_id}`);
        await browser.saveStorageState?.().catch(() => {});
      } catch (e) {
        const msg = e?.message || String(e);
        await availityEligibilityRepo.finishAvailityRun(
          db,
          runId,
          "failed",
          msg,
        );
        failures += 1;
        logger.error(`Availity failed pm_patient_id=${row.pm_patient_id}`, e);
        await browser
          .screenshot(`availity-error-${row.pm_patient_id}`)
          .catch(() => {});
        if (config.availity.stopOnFirstError) break;
      }
    }
  } finally {
    await browser.close();
  }

  return { processed: rows.length, successes, failures };
}
