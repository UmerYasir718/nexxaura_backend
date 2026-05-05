const syncService = require('../services/syncService');
const HttpError = require('../utils/httpError');

async function createDateSync(req, res, next) {
  try {
    const { appointmentDate } = req.body;
    if (!appointmentDate) throw new HttpError(400, 'appointmentDate is required (YYYY-MM-DD)');

    const result = await syncService.requestDateSyncOnly({
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
    return res.status(202).json({
      status: 'good',
      message: result.message || 'Date sync started',
      syncRequestId: result.syncRequestId,
    });
  } catch (error) {
    return next(error);
  }
}

async function createEligibilityVerification(req, res, next) {
  try {
    const { appointmentDate } = req.body;
    if (!appointmentDate) throw new HttpError(400, 'appointmentDate is required (YYYY-MM-DD)');
    const result = await syncService.requestEligibilityVerification({
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
    return res.status(202).json({
      status: 'good',
      message: result.message || 'Eligibility verification started',
      syncRequestId: result.syncRequestId,
    });
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
