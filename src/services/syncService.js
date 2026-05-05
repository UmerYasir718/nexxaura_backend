const db = require("../config/db");
const env = require("../config/env");
const HttpError = require("../utils/httpError");
const { decryptCredentialPassword } = require("../utils/credentialCrypto");
const {
  runEndToEndSync,
  runOfficeAllyStage,
  runAvailityStage,
} = require("./pipelineService");

function decryptVendorPasswordOrThrow(cipherText, providerLabel) {
  try {
    return decryptCredentialPassword(cipherText);
  } catch (e) {
    const msg = String(e?.message || e || "");
    if (/authenticate data|unsupported state/i.test(msg)) {
      throw new HttpError(
        400,
        `${providerLabel} credentials could not be decrypted. This usually means encryption key/secret changed after credentials were saved. Please re-save ${providerLabel} credentials.`,
      );
    }
    throw e;
  }
}

function compactOfficeAllyRows(rows) {
  return (rows || []).map((r) => ({
    patientId: r["Patient ID"] || null,
    appointmentId: r["Appointment ID"] || null,
    firstName: r["First Name"] || null,
    lastName: r["Last Name"] || null,
    dateOfBirth: r["Date Of Birth"] || null,
    time: r.Time || null,
    provider: r.Provider || null,
    status: r.Status || null,
    reason: r.Reason || null,
    hasPatientDetails: Boolean(
      r.patientDetails && !r.patientDetails.scrapeError,
    ),
    scrapeError: r.patientDetails?.scrapeError || null,
  }));
}

function buildOfficeAllyResponse(rows, maxItems = 50) {
  const compact = compactOfficeAllyRows(rows);
  return {
    appointmentCount: compact.length,
    appointmentsSample: compact.slice(0, maxItems),
    truncated: compact.length > maxItems,
  };
}

function buildEligibilityResponse(availity, message) {
  return {
    status: "good",
    message,
    processed: availity.processed,
    successCount: availity.successCount,
    failedCount: (availity.results || []).filter((r) => r.status === "failed")
      .length,
  };
}

/**
 * @returns {Promise<{ officeAllyCreds: {username:string,password:string}, availityCreds: {username:string,password:string} }>}
 */
async function fetchCredentialsForE2E(userId) {
  const { rows } = await db.query(
    `SELECT
      oa.username AS oa_username, oa.password AS oa_password,
      av.username AS av_username, av.password AS av_password
     FROM (SELECT $1::uuid AS uid) u
     LEFT JOIN office_ally_credentials oa ON oa.user_id = u.uid
     LEFT JOIN availity_credentials av ON av.user_id = u.uid`,
    [userId],
  );
  const r = rows[0];
  if (!r || !r.oa_username) {
    throw new HttpError(
      400,
      "Office Ally credentials not configured for this user",
    );
  }
  if (!r || !r.av_username) {
    throw new HttpError(
      400,
      "Availity credentials not configured for this user",
    );
  }
  return {
    officeAllyCreds: {
      username: r.oa_username,
      password: decryptVendorPasswordOrThrow(r.oa_password, "Office Ally"),
    },
    availityCreds: {
      username: r.av_username,
      password: decryptVendorPasswordOrThrow(r.av_password, "Availity"),
    },
  };
}

async function fetchOfficeAllyCreds(userId) {
  const { rows } = await db.query(
    "SELECT username, password FROM office_ally_credentials WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row || !row.username) {
    throw new HttpError(
      400,
      "Office Ally credentials not configured for this user",
    );
  }
  return {
    username: row.username,
    password: decryptVendorPasswordOrThrow(row.password, "Office Ally"),
  };
}

async function fetchAvailityCreds(userId) {
  const { rows } = await db.query(
    "SELECT username, password FROM availity_credentials WHERE user_id = $1 LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row || !row.username) {
    throw new HttpError(
      400,
      "Availity credentials not configured for this user",
    );
  }
  return {
    username: row.username,
    password: decryptVendorPasswordOrThrow(row.password, "Availity"),
  };
}

async function markSyncFailed(syncId, err) {
  const msg = err && err.message != null ? err.message : String(err);
  try {
    await db.query(
      "UPDATE sync_requests SET status = 'failed', message = $2, finished_at = NOW() WHERE id = $1",
      [syncId, msg],
    );
  } catch {
    /* */
  }
}

async function markSyncSuccess(syncId, savedAppointments) {
  await db.query(
    "UPDATE sync_requests SET status = 'success', current_stage = 'complete', message = $2, finished_at = NOW() WHERE id = $1",
    [syncId, `Office Ally complete: saved ${savedAppointments} appointments`],
  );
}

function markSyncSuccessBestEffort(syncId, savedAppointments) {
  setImmediate(() => {
    Promise.resolve(markSyncSuccess(syncId, savedAppointments)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[date-sync success status update failed]", err);
    });
  });
}

function normalizeDateOrThrow(appointmentDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appointmentDate || ""))) {
    throw new HttpError(400, "appointmentDate must be YYYY-MM-DD");
  }
  return appointmentDate;
}

async function findActiveRun(userId) {
  const pre = await db.query(
    `SELECT id, status, message, current_stage
       FROM sync_requests
      WHERE user_id = $1 AND status IN ('running', 'awaiting_otp')
      ORDER BY created_at ASC
      LIMIT 1`,
    [userId],
  );
  return pre.rows[0] || null;
}

async function createSyncRun({
  userId,
  appointmentDate,
  currentStage,
  message,
}) {
  const active = await findActiveRun(userId);
  if (active) {
    return {
      alreadyProcessing: true,
      syncRequestId: active.id,
      status: active.status,
      message: active.message,
    };
  }

  try {
    const ins = await db.query(
      `INSERT INTO sync_requests
        (user_id, appointment_date, current_stage, status, message, started_at)
       VALUES ($1, $2, $3, 'running', $4, NOW())
       RETURNING id`,
      [userId, appointmentDate, currentStage, message],
    );
    return { syncRequestId: ins.rows[0].id };
  } catch (e) {
    if (e && e.code === "23505") {
      const again = await findActiveRun(userId);
      if (again) {
        return {
          alreadyProcessing: true,
          syncRequestId: again.id,
          status: again.status,
          message: again.message,
        };
      }
    }
    throw e;
  }
}

/**
 * @returns {Promise<{ alreadyProcessing?: true, syncRequestId: string, message?: string, status?: string }>}
 */
async function requestDateSync({ userId, appointmentDate }) {
  normalizeDateOrThrow(appointmentDate);

  const { officeAllyCreds: oa, availityCreds: av } =
    await fetchCredentialsForE2E(userId);

  const created = await createSyncRun({
    userId,
    appointmentDate,
    currentStage: "office_ally",
    message: "queued",
  });
  if (created.alreadyProcessing) {
    return created;
  }
  const syncId = created.syncRequestId;

  if (env.useSyncQueue) {
    const { enqueueE2eSync } = require("../queue/syncQueue");
    try {
      await enqueueE2eSync({ userId, syncId, appointmentDate });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[enqueue sync failed]", e);
      await markSyncFailed(syncId, e);
      throw e;
    }
  } else {
    setImmediate(() => {
      runEndToEndSync({
        userId,
        appointmentDate,
        syncId,
        officeAllyCreds: oa,
        availityCreds: av,
      })
        // eslint-disable-next-line no-console
        .catch((err) => {
          console.error("[sync pipeline failed]", err);
          return markSyncFailed(syncId, err);
        });
    });
  }

  return { syncRequestId: syncId, message: "Sync started" };
}

async function runDateSyncOnly({
  userId,
  appointmentDate,
  awaitSuccessStatus = false,
}) {
  const date = normalizeDateOrThrow(appointmentDate);
  // eslint-disable-next-line no-console
  console.log(`[date-sync] request received userId=${userId} date=${date}`);
  const officeAllyCreds = await fetchOfficeAllyCreds(userId);
  // eslint-disable-next-line no-console
  console.log(`[date-sync] office ally credentials loaded userId=${userId}`);
  const created = await createSyncRun({
    userId,
    appointmentDate: date,
    currentStage: "office_ally",
    message: "Office Ally endpoint started",
  });
  if (created.alreadyProcessing) {
    // eslint-disable-next-line no-console
    console.log(
      `[date-sync] blocked by active run syncId=${created.syncRequestId}`,
    );
    return created;
  }
  const syncId = created.syncRequestId;
  // eslint-disable-next-line no-console
  console.log(
    `[date-sync] sync run created syncId=${syncId}; starting office ally save`,
  );
  try {
    const { savedAppointments } = await runOfficeAllyStage({
      userId,
      appointmentDate: date,
      syncId,
      officeAllyCreds,
    });
    if (awaitSuccessStatus) {
      await markSyncSuccess(syncId, savedAppointments);
    } else {
      markSyncSuccessBestEffort(syncId, savedAppointments);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[date-sync] response ready saved=${savedAppointments} syncId=${syncId}`,
    );

    return {
      status: "good",
      message: "Office Ally date sync completed",
      savedAppointments,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[date-sync office ally failed]", err);
    await markSyncFailed(syncId, err);
    throw err;
  }
}

async function requestDateSyncOnly({ userId, appointmentDate }) {
  const date = normalizeDateOrThrow(appointmentDate);
  const officeAllyCreds = await fetchOfficeAllyCreds(userId);
  const created = await createSyncRun({
    userId,
    appointmentDate: date,
    currentStage: "office_ally",
    message: "Office Ally endpoint started",
  });
  if (created.alreadyProcessing) {
    return created;
  }
  const syncId = created.syncRequestId;
  setImmediate(() => {
    runOfficeAllyStage({
      userId,
      appointmentDate: date,
      syncId,
      officeAllyCreds,
    })
      .then(({ savedAppointments }) => {
        markSyncSuccessBestEffort(syncId, savedAppointments);
      })
      // eslint-disable-next-line no-console
      .catch((err) => {
        console.error("[date-sync office ally failed]", err);
        return markSyncFailed(syncId, err);
      });
  });
  return { syncRequestId: syncId, message: "Date sync started" };
}

async function runEligibilityVerification({ userId, appointmentDate }) {
  const date = normalizeDateOrThrow(appointmentDate);
  const availityCreds = await fetchAvailityCreds(userId);
  const created = await createSyncRun({
    userId,
    appointmentDate: date,
    currentStage: "availity",
    message: "Availity eligibility endpoint started",
  });
  if (created.alreadyProcessing) {
    return created;
  }
  const syncId = created.syncRequestId;
  try {
    const availity = await runAvailityStage({
      userId,
      syncId,
      availityCreds,
      appointmentDate: date,
      officeAllySavedAppointments: null,
    });
    return buildEligibilityResponse(
      availity,
      "Eligibility verification completed",
    );
  } catch (e) {
    await markSyncFailed(syncId, e);
    throw e;
  }
}

async function requestEligibilityVerification({ userId, appointmentDate }) {
  const date = normalizeDateOrThrow(appointmentDate);
  const availityCreds = await fetchAvailityCreds(userId);
  const created = await createSyncRun({
    userId,
    appointmentDate: date,
    currentStage: "availity",
    message: "Availity eligibility endpoint started",
  });
  if (created.alreadyProcessing) {
    return created;
  }
  const syncId = created.syncRequestId;
  setImmediate(() => {
    runAvailityStage({
      userId,
      syncId,
      availityCreds,
      appointmentDate: date,
      officeAllySavedAppointments: null,
    })
      .catch((err) => markSyncFailed(syncId, err));
  });
  return { syncRequestId: syncId, message: "Eligibility verification started" };
}

async function runEligibilityAndInsurance({ userId, appointmentDate }) {
  const date = normalizeDateOrThrow(appointmentDate);
  // eslint-disable-next-line no-console
  console.log(`[combined-sync] date-sync starting date=${date}`);
  const officeAlly = await runDateSyncOnly({
    userId,
    appointmentDate: date,
    awaitSuccessStatus: true,
  });
  if (officeAlly.alreadyProcessing) {
    return officeAlly;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[combined-sync] date-sync done saved=${officeAlly.savedAppointments}; eligibility starting date=${date}`,
  );
  const eligibility = await runEligibilityVerification({
    userId,
    appointmentDate: date,
  });
  if (eligibility.alreadyProcessing) {
    return eligibility;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[combined-sync] eligibility done processed=${eligibility.processed}`,
  );
  return {
    status: "good",
    message: "Eligibility and insurance completed",
    savedAppointments: officeAlly.savedAppointments,
    eligibility,
  };
}

async function getRunByIdForUser(userId, syncRequestId) {
  const { rows } = await db.query(
    "SELECT * FROM sync_requests WHERE id = $1 AND user_id = $2 LIMIT 1",
    [syncRequestId, userId],
  );
  return rows[0] || null;
}

async function getRunsByUser(userId) {
  const { rows } = await db.query(
    "SELECT * FROM sync_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25",
    [userId],
  );
  return rows;
}

module.exports = {
  requestDateSync,
  requestDateSyncOnly,
  runDateSyncOnly,
  requestEligibilityVerification,
  runEligibilityVerification,
  runEligibilityAndInsurance,
  getRunsByUser,
  getRunByIdForUser,
  fetchCredentialsForE2E,
  markSyncFailed,
};
