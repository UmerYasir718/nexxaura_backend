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

async function getAppointmentsByPatient(req, res, next) {
  try {
    const { patientId } = req.params;
    const rows = await dataService.listAppointmentsByPatient(req.user.id, patientId);
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

async function getPatientInsuranceByPatient(req, res, next) {
  try {
    const { patientId } = req.params;
    const rows = await dataService.listPatientInsuranceByPatient(req.user.id, patientId);
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

async function getAvailitySummaryByPatient(req, res, next) {
  try {
    const { patientId } = req.params;
    const rows = await dataService.listAvailitySummaryByPatient(req.user.id, patientId);
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
  getAppointmentsByPatient,
  getPatients,
  getPatientInsurance,
  getPatientInsuranceByPatient,
  getAvailitySummary,
  getAvailitySummaryByPatient,
  getDashboard,
};
