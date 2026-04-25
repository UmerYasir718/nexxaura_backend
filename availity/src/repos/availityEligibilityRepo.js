export async function startAvailityRun(db, { patientId, coverageRank, payerNameUsed, memberIdUsed }) {
  const r = await db.query(
    `INSERT INTO availity_eligibility_runs (
       patient_id, coverage_rank, payer_name_used, member_id_used, status
     ) VALUES ($1, $2, $3, $4, 'running')
     RETURNING id`,
    [patientId, coverageRank, payerNameUsed || null, memberIdUsed || null],
  );
  return r.rows[0].id;
}

export async function finishAvailityRun(db, runId, status, message) {
  await db.query(
    `UPDATE availity_eligibility_runs
     SET finished_at = NOW(), status = $2, message = $3
     WHERE id = $1`,
    [runId, status, message || null],
  );
}

export async function insertAvailityResult(db, runId, row) {
  const r = await db.query(
    `INSERT INTO availity_eligibility_results (
       run_id, coverage_status_text, is_active, member_id, payer_id, patient_name_on_file,
       benefit_line, date_of_service, transaction_date, insurance_type, plan_product,
       coverage_level, raw_snapshot
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     RETURNING id`,
    [
      runId,
      row.coverageStatusText || null,
      row.isActive ?? null,
      row.memberId || null,
      row.payerId || null,
      row.patientNameOnFile || null,
      row.benefitLine || null,
      row.dateOfService || null,
      row.transactionDate || null,
      row.insuranceType || null,
      row.planProduct || null,
      row.coverageLevel || null,
      row.rawSnapshot ? JSON.stringify(row.rawSnapshot) : null,
    ],
  );
  return r.rows[0].id;
}
