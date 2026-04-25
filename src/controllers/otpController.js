const otpService = require('../services/otpService');
const HttpError = require('../utils/httpError');

async function submitOtp(req, res, next) {
  try {
    const { syncRequestId, code } = req.body;
    if (!syncRequestId) throw new HttpError(400, 'syncRequestId is required');
    const r = await otpService.submitOtpForSync({
      userId: req.user.id,
      syncRequestId,
      code,
    });
    return res.status(200).json(r);
  } catch (e) {
    return next(e);
  }
}

module.exports = { submitOtp };
