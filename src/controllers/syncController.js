const syncService = require('../services/syncService');
const HttpError = require('../utils/httpError');

async function createDateSync(req, res, next) {
  try {
    const { appointmentDate } = req.body;
    if (!appointmentDate) throw new HttpError(400, 'appointmentDate is required (YYYY-MM-DD)');

    // eslint-disable-next-line no-console
    console.log(`[date-sync] controller start userId=${req.user.id} date=${appointmentDate}`);
    const result = await syncService.runDateSyncOnly({
      userId: req.user.id,
      appointmentDate,
    });
    if (result.alreadyProcessing) {
      // eslint-disable-next-line no-console
      console.log(`[date-sync] controller response 409 syncId=${result.syncRequestId}`);
      return res.status(409).json({
        message: 'A sync is already running for this user',
        syncRequestId: result.syncRequestId,
        status: result.status,
        detail: result.message,
      });
    }
    // eslint-disable-next-line no-console
    console.log('[date-sync] controller response 200 sent');
    return res.status(200).json(result);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[date-sync] controller failed', error);
    return next(error);
  }
}

async function createEligibilityVerification(req, res, next) {
  try {
    const { appointmentDate } = req.body;
    if (!appointmentDate) throw new HttpError(400, 'appointmentDate is required (YYYY-MM-DD)');
    const result = await syncService.runEligibilityVerification({
      userId: req.user.id,
      appointmentDate,
    });
    if (result.alreadyProcessing) {
      return res.status(409).json({
        message: 'A sync is already running for this user',
        syncRequestId: result.syncRequestId,
        status: result.status,
        detail: result.message,
      });
    }
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function createEligibilityAndInsurance(req, res, next) {
  try {
    const { appointmentDate } = req.body;
    if (!appointmentDate) throw new HttpError(400, 'appointmentDate is required (YYYY-MM-DD)');
    const result = await syncService.runEligibilityAndInsurance({
      userId: req.user.id,
      appointmentDate,
    });
    if (result.alreadyProcessing) {
      return res.status(409).json({
        message: 'A sync is already running for this user',
        syncRequestId: result.syncRequestId,
        status: result.status,
        detail: result.message,
      });
    }
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function getMyRuns(req, res, next) {
  try {
    const rows = await syncService.getRunsByUser(req.user.id);
    return res.status(200).json(rows);
  } catch (error) {
    return next(error);
  }
}

async function getRunById(req, res, next) {
  try {
    const { id } = req.params;
    const row = await syncService.getRunByIdForUser(req.user.id, id);
    if (!row) throw new HttpError(404, 'Not found');
    return res.status(200).json(row);
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  createDateSync,
  createEligibilityVerification,
  createEligibilityAndInsurance,
  getMyRuns,
  getRunById,
};
