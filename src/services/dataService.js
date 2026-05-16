const db = require('../config/db');
const cacheService = require('./cacheService');
const { remittanceEobRowsToXlsxBuffer } = require('../utils/remittanceEobExcel');

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
        res.patient_name_on_file,
        res.date_of_service,
        res.transaction_date,
        res.insurance_type,
        res.plan_product,
        res.coverage_level,
        res.annual_deductible_network,
        res.annual_deductible_total_amount,
        res.annual_deductible_met_amount,
        res.annual_deductible_remaining_amount,
        res.oop_remaining_amount
     FROM latest l
     JOIN patients p ON p.id = l.patient_id
     LEFT JOIN LATERAL (
       SELECT
         x.coverage_status_text,
         x.is_active,
         x.member_id,
         x.patient_name_on_file,
         x.date_of_service,
         x.transaction_date,
         x.insurance_type,
         x.plan_product,
         x.coverage_level,
         x.annual_deductible_network,
         x.annual_deductible_total_amount,
         x.annual_deductible_met_amount,
         x.annual_deductible_remaining_amount,
         x.oop_remaining_amount
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
        res.patient_name_on_file,
        res.date_of_service,
        res.transaction_date,
        res.insurance_type,
        res.plan_product,
        res.coverage_level,
        res.annual_deductible_network,
        res.annual_deductible_total_amount,
        res.annual_deductible_met_amount,
        res.annual_deductible_remaining_amount,
        res.oop_remaining_amount
     FROM latest l
     JOIN patients p ON p.id = l.patient_id
     LEFT JOIN LATERAL (
       SELECT
         x.coverage_status_text,
         x.is_active,
         x.member_id,
         x.patient_name_on_file,
         x.date_of_service,
         x.transaction_date,
         x.insurance_type,
         x.plan_product,
         x.coverage_level,
         x.annual_deductible_network,
         x.annual_deductible_total_amount,
         x.annual_deductible_met_amount,
         x.annual_deductible_remaining_amount,
         x.oop_remaining_amount
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

/** @param {object} res */
function mapInsuranceResultFromDbRow(res) {
  return {
    id: res.id,
    run_id: res.run_id,
    created_at: res.created_at,
    patient: {
      name: res.patient_name_on_file,
      member_id: res.member_id,
      date_of_birth: res.date_of_birth,
      date_of_service: res.date_of_service,
      transaction_date: res.transaction_date,
      transaction_time: res.transaction_time,
      transaction_id: res.transaction_id,
      customer_id: res.customer_id,
    },
    plan: {
      member_id: res.member_id,
      group_number: res.group_number,
      group_name: res.group_name,
      plan_number: res.plan_number,
      plan_begin_date: res.plan_begin_date,
      eligibility_begin_date: res.eligibility_begin_date,
      insurance_type: res.insurance_type,
      plan_product: res.plan_product,
      coverage_level: res.coverage_level,
    },
    coverage: {
      status_text: res.coverage_status_text,
      is_active: res.is_active,
    },
    plan_maximums: {
      annual_deductible: {
        network: res.annual_deductible_network,
        total_amount: res.annual_deductible_total_amount,
        met_amount: res.annual_deductible_met_amount,
        remaining_amount: res.annual_deductible_remaining_amount,
      },
      out_of_pocket: {
        network: res.oop_network,
        total_amount: res.oop_total_amount,
        met_amount: res.oop_met_amount,
        remaining_amount: res.oop_remaining_amount,
      },
    },
  };
}

/** @param {object[]} serviceRows */
function groupBenefitsByCategory(serviceRows) {
  /** @type {Map<string, { name: string, stc_code: string | null, services: object[] }>} */
  const byCategory = new Map();
  for (const s of serviceRows) {
    const name = s.benefit_category_name || 'Unknown';
    const stcCode = s.stc_code != null ? String(s.stc_code) : null;
    const key = `${name}\0${stcCode || ''}`;
    if (!byCategory.has(key)) {
      byCategory.set(key, { name, stc_code: stcCode, services: [] });
    }
    byCategory.get(key).services.push({
      id: s.id,
      description: s.service_description,
      copay: s.copay_amount != null ? Number(s.copay_amount) : null,
      copay_text: s.copay_text,
      coinsurance: s.coinsurance_percent != null ? Number(s.coinsurance_percent) : null,
      notes: s.notes,
    });
  }
  return [...byCategory.values()];
}

/**
 * Patient + insurance + appointments + Availity eligibility (summary + per-service benefits).
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

  const [insRes, apptRes, runsRes, resultsRes, benefitServicesRes] =
    await Promise.all([
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
              res.patient_name_on_file, res.date_of_birth, res.date_of_service, res.transaction_date,
              res.transaction_time, res.transaction_id, res.customer_id,
              res.insurance_type, res.plan_product, res.coverage_level,
              res.group_number, res.group_name, res.plan_number, res.plan_begin_date, res.eligibility_begin_date,
              res.annual_deductible_network, res.annual_deductible_total_amount,
              res.annual_deductible_met_amount, res.annual_deductible_remaining_amount,
              res.oop_network, res.oop_total_amount, res.oop_met_amount, res.oop_remaining_amount,
              res.created_at
         FROM availity_eligibility_results res
         INNER JOIN availity_eligibility_runs r ON r.id = res.run_id
        WHERE r.user_id = $1 AND r.patient_id = $2
        ORDER BY res.created_at DESC`,
      [userId, patientId],
    ),
    db.query(
      `SELECT s.id, s.result_id, s.run_id, s.benefit_category_name, s.stc_code,
              s.service_description, s.copay_amount, s.copay_text, s.coinsurance_percent, s.notes, s.created_at
         FROM availity_eligibility_benefit_services s
         INNER JOIN availity_eligibility_runs r ON r.id = s.run_id
        WHERE r.user_id = $1 AND r.patient_id = $2
        ORDER BY s.created_at DESC, s.benefit_category_name, s.service_description`,
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

  /** @type {Map<string, object[]>} */
  const servicesByResult = new Map();
  for (const row of benefitServicesRes.rows) {
    const rid = row.result_id;
    if (!servicesByResult.has(rid)) servicesByResult.set(rid, []);
    servicesByResult.get(rid).push(row);
  }

  const eligibility_checks = runsRes.rows.map((run) => {
    const resultRows = byRun.get(run.id) || [];
    return {
      run: {
        id: run.id,
        status: run.status,
        coverage_rank: run.coverage_rank,
        payer_name_used: run.payer_name_used,
        member_id_used: run.member_id_used,
        started_at: run.started_at,
        finished_at: run.finished_at,
        message: run.message,
      },
      results: resultRows.map((res) => ({
        insurance_result: mapInsuranceResultFromDbRow(res),
        benefits: groupBenefitsByCategory(servicesByResult.get(res.id) || []),
      })),
    };
  });

  const latestCheck =
    eligibility_checks.find((c) => c.run.status === 'success' && c.results.length > 0) ||
    eligibility_checks.find((c) => c.results.length > 0) ||
    null;
  const latest =
    latestCheck && latestCheck.results[0]
      ? {
          run: latestCheck.run,
          insurance_result: latestCheck.results[0].insurance_result,
          benefits: latestCheck.results[0].benefits,
        }
      : null;

  return {
    patientId,
    patient: patientRes.rows[0],
    patient_insurance: insRes.rows,
    appointments: apptRes.rows,
    latest_eligibility: latest,
    eligibility_checks,
  };
}

/**
 * EOB rows for remittance files owned by the user, joined to patient DOB when
 * `primary_insured_id` matches `patient_insurance.member_id` and the patient
 * has at least one `patient_visits` row for this user.
 *
 * @param {string} userId
 * @returns {Promise<Buffer>} xlsx
 */
async function exportAvailityRemittanceEobRowsForUserExcelBuffer(userId) {
  const { rows } = await db.query(
    `SELECT
        e.id,
        e.file_id,
        e.claim_no,
        e.patient_name,
        m.dob AS dob,
        e.primary_insured_id,
        e.office_ally,
        e.dos,
        e.work_status,
        e.insurance,
        e.total_charges,
        e.allowed_amount,
        e.primary_paid,
        e.patient_responsibility,
        e.adjustment,
        e.balance,
        e.chk_eft,
        e.chk_eft_date,
        e.remittance_status,
        e.remittance_sub_status,
        e.action,
        e.remarks,
        e.source_row_index,
        e.created_at,
        e.updated_at
     FROM availity_claim_remittance_eob_rows e
     INNER JOIN availity_claim_remittance_files f
       ON f.id = e.file_id AND f.user_id = $1
     INNER JOIN LATERAL (
       SELECT pat.date_of_birth AS dob
         FROM patient_insurance pi
         INNER JOIN patients pat ON pat.id = pi.patient_id AND pat.user_id = $1
         INNER JOIN patient_visits pv ON pv.user_id = $1 AND pv.patient_id = pat.id
        WHERE NULLIF(TRIM(pi.member_id), '') IS NOT NULL
          AND NULLIF(TRIM(e.primary_insured_id), '') IS NOT NULL
          AND LOWER(TRIM(pi.member_id)) = LOWER(TRIM(e.primary_insured_id))
        ORDER BY pi.coverage_rank
        LIMIT 1
     ) m ON TRUE
     ORDER BY e.dos NULLS LAST, e.created_at DESC`,
    [userId],
  );
  return remittanceEobRowsToXlsxBuffer(rows);
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
  exportAvailityRemittanceEobRowsForUserExcelBuffer,
};
