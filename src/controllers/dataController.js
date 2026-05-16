const dataService = require('../services/dataService');
const { stripIntegrationRaw } = require('../utils/sanitizeDataResponse');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Bearer auth — xlsx of remittance EOB rows scoped to the user (see dataService). */
async function getAvailityRemittanceEobExport(req, res, next) {
  try {
    const buf = await dataService.exportAvailityRemittanceEobRowsForUserExcelBuffer(
      req.user.id,
    );
    const day = new Date().toISOString().slice(0, 10);
    const filename = `availity-claim-remittance-eob-${day}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (e) {
    return next(e);
  }
}

/** POST body: { "patientId": "<uuid>" } — patient, insurance, appointments, eligibility summary + per-service benefits. */
async function postPatientInsuranceEligibilityDetail(req, res, next) {
  try {
    const patientId = req.body?.patientId ?? req.body?.patient_id;
    if (!patientId || typeof patientId !== 'string') {
      return res.status(400).json({ error: 'patientId is required in JSON body' });
    }
    const trimmed = patientId.trim();
    if (!UUID_RE.test(trimmed)) {
      return res.status(400).json({ error: 'patientId must be a valid UUID' });
    }
    const bundle = await dataService.getPatientInsuranceEligibilityDetail(req.user.id, trimmed);
    if (!bundle) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    return res.json(stripIntegrationRaw(bundle));
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
  postPatientInsuranceEligibilityDetail,
  getAvailityRemittanceEobExport,
};
