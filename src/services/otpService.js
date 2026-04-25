const redis = require('../config/redis');
const db = require('../config/db');
const HttpError = require('../utils/httpError');

const OTP_TTL_SEC = 900;

/**
 * Frontend posts MFA/OTP for an active sync in awaiting_otp state.
 */
async function submitOtpForSync({ userId, syncRequestId, code }) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 4) throw new HttpError(400, 'code is required (usually 6 digits)');

  const { rows } = await db.query(
    `SELECT id, status, user_id FROM sync_requests
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [syncRequestId, userId],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Sync request not found');
  if (row.status !== 'awaiting_otp') {
    throw new HttpError(400, 'Sync is not waiting for an MFA code right now');
  }

  const key = `sync:otp:${syncRequestId}`;
  await redis.set(key, c, 'EX', OTP_TTL_SEC);
  return { ok: true, syncRequestId, message: 'Code stored; Availity flow will read it' };
}

module.exports = { submitOtpForSync, OTP_TTL_SEC };
