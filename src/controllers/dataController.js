const dataService = require('../services/dataService');
const { stripIntegrationRaw } = require('../utils/sanitizeDataResponse');

async function getAppointments(req, res, next) {
  try {
    const rows = await dataService.listAppointments(req.user.id);
    return res.json(stripIntegrationRaw(rows));
  } catch (e) {
    return next(e);
  }
}

async function getPatients(req, res, next) {
  try {
    const rows = await dataService.listPatients(req.user.id);
    return res.json(stripIntegrationRaw(rows));
  } catch (e) {
    return next(e);
  }
}

async function getPatientInsurance(req, res, next) {
  try {
    const rows = await dataService.listPatientInsurance(req.user.id);
    return res.json(stripIntegrationRaw(rows));
  } catch (e) {
    return next(e);
  }
}

async function getAvailitySummary(req, res, next) {
  try {
    const rows = await dataService.listAvailitySummary(req.user.id);
    return res.json(stripIntegrationRaw(rows));
  } catch (e) {
    return next(e);
  }
}

async function getDashboard(req, res, next) {
  try {
    const d = await dataService.getDashboardForUser(req.user.id);
    return res.json(stripIntegrationRaw(d));
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  getAppointments,
  getPatients,
  getPatientInsurance,
  getAvailitySummary,
  getDashboard,
};
