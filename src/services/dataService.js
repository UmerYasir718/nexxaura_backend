const db = require('../config/db');
const cacheService = require('./cacheService');

async function listAppointments(userId) {
  const { rows } = await db.query(
    `SELECT
        a.id, a.sync_request_id, a.user_id, a.pm_appointment_id, a.patient_id,
        a.patient_id AS system_patient_id, a.appointment_date,
        a.starts_at, a.provider_name, a.status, a.reason, a.created_at, a.updated_at,
        p.pm_patient_id AS patient_pm_id, p.first_name AS patient_first_name, p.last_name AS patient_last_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.user_id = $1
     ORDER BY a.appointment_date DESC, a.starts_at DESC NULLS LAST
     LIMIT 500`,
    [userId],
  );
  return rows;
}

async function listAppointmentsByPatient(userId, patientId) {
  const { rows } = await db.query(
    `SELECT
        a.id, a.sync_request_id, a.user_id, a.pm_appointment_id, a.patient_id,
        a.patient_id AS system_patient_id, a.appointment_date,
        a.starts_at, a.provider_name, a.status, a.reason, a.created_at, a.updated_at,
        p.pm_patient_id AS patient_pm_id, p.first_name AS patient_first_name, p.last_name AS patient_last_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     WHERE a.user_id = $1 AND a.patient_id = $2
     ORDER BY a.appointment_date DESC, a.starts_at DESC NULLS LAST
     LIMIT 500`,
    [userId, patientId],
  );
  return rows;
}

async function listPatients(userId) {
  const { rows } = await db.query(
    `SELECT id, user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email,
            created_at, updated_at
     FROM patients
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1000`,
    [userId],
  );
  return rows;
}

async function listPatientInsurance(userId) {
  const { rows } = await db.query(
    `SELECT
        pi.id, pi.patient_id, pi.coverage_rank, pi.payer_name, pi.member_id, pi.plan_name,
        pi.group_number, pi.relationship, pi.created_at, pi.updated_at,
        p.pm_patient_id, p.first_name, p.last_name
     FROM patient_insurance pi
     JOIN patients p ON p.id = pi.patient_id
     WHERE p.user_id = $1
     ORDER BY p.pm_patient_id, pi.coverage_rank
     LIMIT 2000`,
    [userId],
  );
  return rows;
}

async function listPatientInsuranceByPatient(userId, patientId) {
  const { rows } = await db.query(
    `SELECT
        pi.id, pi.patient_id, pi.coverage_rank, pi.payer_name, pi.member_id, pi.plan_name,
        pi.group_number, pi.relationship, pi.created_at, pi.updated_at,
        p.pm_patient_id, p.first_name, p.last_name
     FROM patient_insurance pi
     JOIN patients p ON p.id = pi.patient_id
     WHERE p.user_id = $1 AND p.id = $2
     ORDER BY pi.coverage_rank
     LIMIT 50`,
    [userId, patientId],
  );
  return rows;
}

/** Latest Availity run per patient (user-scoped) + latest stored result for that run */
async function listAvailitySummary(userId) {
  const { rows } = await db.query(
    `WITH latest AS (
        SELECT DISTINCT ON (patient_id) *
        FROM availity_eligibility_runs
        WHERE user_id = $1
        ORDER BY patient_id, started_at DESC
     )
     SELECT
        l.id AS run_id,
        l.patient_id,
        p.pm_patient_id,
        l.coverage_rank,
        l.payer_name_used,
        l.member_id_used,
        l.status AS run_status,
        l.started_at,
        l.finished_at,
        l.message AS run_message,
        res.coverage_status_text,
        res.is_active,
        res.member_id AS result_member_id,
        res.payer_id,
        res.benefit_line,
        res.date_of_service,
        res.transaction_date,
        res.copay_amount,
        res.deductible_amount,
        res.coinsurance,
        res.oop_remaining
     FROM latest l
     JOIN patients p ON p.id = l.patient_id
     LEFT JOIN LATERAL (
       SELECT
         x.coverage_status_text,
         x.is_active,
         x.member_id,
         x.payer_id,
         x.benefit_line,
         x.date_of_service,
         x.transaction_date,
         x.copay_amount,
         x.deductible_amount,
         x.coinsurance,
         x.oop_remaining
       FROM availity_eligibility_results x
       WHERE x.run_id = l.id
       ORDER BY x.created_at DESC
       LIMIT 1
     ) res ON true
     ORDER BY p.pm_patient_id`,
    [userId],
  );
  return rows;
}

async function listAvailitySummaryByPatient(userId, patientId) {
  const { rows } = await db.query(
    `WITH latest AS (
        SELECT DISTINCT ON (patient_id) *
        FROM availity_eligibility_runs
        WHERE user_id = $1 AND patient_id = $2
        ORDER BY patient_id, started_at DESC
     )
     SELECT
        l.id AS run_id,
        l.patient_id,
        p.pm_patient_id,
        l.coverage_rank,
        l.payer_name_used,
        l.member_id_used,
        l.status AS run_status,
        l.started_at,
        l.finished_at,
        l.message AS run_message,
        res.coverage_status_text,
        res.is_active,
        res.member_id AS result_member_id,
        res.payer_id,
        res.benefit_line,
        res.date_of_service,
        res.transaction_date,
        res.copay_amount,
        res.deductible_amount,
        res.coinsurance,
        res.oop_remaining
     FROM latest l
     JOIN patients p ON p.id = l.patient_id
     LEFT JOIN LATERAL (
       SELECT
         x.coverage_status_text,
         x.is_active,
         x.member_id,
         x.payer_id,
         x.benefit_line,
         x.date_of_service,
         x.transaction_date,
         x.copay_amount,
         x.deductible_amount,
         x.coinsurance,
         x.oop_remaining
       FROM availity_eligibility_results x
       WHERE x.run_id = l.id
       ORDER BY x.created_at DESC
       LIMIT 1
     ) res ON true
     ORDER BY p.pm_patient_id`,
    [userId, patientId],
  );
  return rows;
}

/** Single dashboard object for clients that want one call (short-TTL Redis cache) */
async function getDashboardForUser(userId) {
  return cacheService.getOrSet('dashboard', userId, async () => {
    const [appointments, patients, insurance, availity] = await Promise.all([
      listAppointments(userId),
      listPatients(userId),
      listPatientInsurance(userId),
      listAvailitySummary(userId),
    ]);
    return { appointments, patients, patient_insurance: insurance, availity: availity };
  });
}

/**
 * Full patient row + insurance rows + appointments + every Availity eligibility run with all result rows
 * (includes raw_snapshot / raw_payload — intended for this authenticated detail endpoint only).
 * @param {string} userId
 * @param {string} patientId UUID
 * @returns {Promise<null | object>}
 */
async function getPatientInsuranceEligibilityDetail(userId, patientId) {
  const patientRes = await db.query(
    `SELECT id, user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email,
            raw_payload, created_at, updated_at
       FROM patients
      WHERE id = $1 AND user_id = $2`,
    [patientId, userId],
  );
  if (!patientRes.rows.length) return null;

  const [insRes, apptRes, runsRes, resultsRes] = await Promise.all([
    db.query(
      `SELECT id, patient_id, coverage_rank, payer_name, member_id, plan_name, group_number, relationship,
              raw_payload, created_at, updated_at
         FROM patient_insurance
        WHERE patient_id = $1
        ORDER BY coverage_rank`,
      [patientId],
    ),
    db.query(
      `SELECT id, sync_request_id, user_id, pm_appointment_id, patient_id, appointment_date, starts_at,
              provider_name, status, reason, created_at, updated_at
         FROM appointments
        WHERE user_id = $1 AND patient_id = $2
        ORDER BY appointment_date DESC, starts_at DESC NULLS LAST
        LIMIT 500`,
      [userId, patientId],
    ),
    db.query(
      `SELECT id, user_id, patient_id, coverage_rank, payer_name_used, member_id_used, started_at, finished_at,
              status, message
         FROM availity_eligibility_runs
        WHERE user_id = $1 AND patient_id = $2
        ORDER BY started_at DESC`,
      [userId, patientId],
    ),
    db.query(
      `SELECT res.id, res.run_id, res.coverage_status_text, res.is_active, res.member_id, res.payer_id,
              res.patient_name_on_file, res.benefit_line, res.date_of_service, res.transaction_date,
              res.insurance_type, res.plan_product, res.coverage_level, res.copay_amount, res.deductible_amount,
              res.coinsurance, res.oop_remaining, res.raw_snapshot, res.created_at
         FROM availity_eligibility_results res
         INNER JOIN availity_eligibility_runs r ON r.id = res.run_id
        WHERE r.user_id = $1 AND r.patient_id = $2
        ORDER BY res.created_at DESC`,
      [userId, patientId],
    ),
  ]);

  /** @type {Map<string, object[]>} */
  const byRun = new Map();
  for (const row of resultsRes.rows) {
    const rid = row.run_id;
    if (!byRun.has(rid)) byRun.set(rid, []);
    byRun.get(rid).push(row);
  }

  const runsWithResults = runsRes.rows.map((run) => ({
    ...run,
    results: byRun.get(run.id) || [],
  }));

  return {
    patientId,
    patient: patientRes.rows[0],
    patient_insurance: insRes.rows,
    appointments: apptRes.rows,
    availity_eligibility_runs: runsWithResults,
  };
}

module.exports = {
  listAppointments,
  listAppointmentsByPatient,
  listPatients,
  listPatientInsurance,
  listPatientInsuranceByPatient,
  listAvailitySummary,
  listAvailitySummaryByPatient,
  getDashboardForUser,
  getPatientInsuranceEligibilityDetail,
};
