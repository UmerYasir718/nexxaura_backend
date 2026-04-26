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

module.exports = {
  listAppointments,
  listAppointmentsByPatient,
  listPatients,
  listPatientInsurance,
  listPatientInsuranceByPatient,
  listAvailitySummary,
  listAvailitySummaryByPatient,
  getDashboardForUser,
};
