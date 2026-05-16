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

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} runId
 * @param {string} patientId
 * @param {{ result: object, benefitServices?: object[], benefitsPayload?: object }} bundle
 */
export async function insertAvailityEligibilityBundle(db, runId, patientId, bundle) {
  const { result, benefitServices = [], benefitsPayload } = bundle;
  const client = db.connect ? await db.connect() : db;
  const ownedClient = Boolean(db.connect);
  try {
    if (ownedClient) await client.query("BEGIN");

    const ins = await client.query(
      `INSERT INTO availity_eligibility_results (
         run_id, coverage_status_text, is_active, member_id, payer_id, patient_name_on_file,
         date_of_birth, date_of_service, transaction_date, transaction_time, transaction_id, customer_id,
         insurance_type, plan_product, coverage_level,
         group_number, group_name, plan_number, plan_begin_date, eligibility_begin_date,
         annual_deductible_network, annual_deductible_total_amount, annual_deductible_met_amount, annual_deductible_remaining_amount,
         oop_network, oop_total_amount, oop_met_amount, oop_remaining_amount,
         benefits_json_path, raw_snapshot
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
         $21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb
       )
       RETURNING id`,
      [
        runId,
        result.coverageStatusText || null,
        result.isActive ?? null,
        result.memberId || null,
        result.payerId || null,
        result.patientNameOnFile || null,
        result.dateOfBirth || null,
        result.dateOfService || null,
        result.transactionDate || null,
        result.transactionTime || null,
        result.transactionId || null,
        result.customerId || null,
        result.insuranceType || null,
        result.planProduct || null,
        result.coverageLevel || null,
        result.groupNumber || null,
        result.groupName || null,
        result.planNumber || null,
        result.planBeginDate || null,
        result.eligibilityBeginDate || null,
        result.annualDeductibleNetwork || null,
        result.annualDeductibleTotal ?? null,
        result.annualDeductibleMet ?? null,
        result.annualDeductibleRemaining ?? null,
        result.oopNetwork || null,
        result.oopTotal ?? null,
        result.oopMet ?? null,
        result.oopRemaining ?? null,
        result.benefitsJsonPath || null,
        benefitsPayload ? JSON.stringify(benefitsPayload) : null,
      ],
    );
    const resultId = ins.rows[0].id;

    for (const svc of benefitServices) {
      await client.query(
        `INSERT INTO availity_eligibility_benefit_services (
           result_id, run_id, patient_id, benefit_category_name, stc_code,
           service_description, copay_amount, copay_text, coinsurance_percent, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          resultId,
          runId,
          patientId,
          svc.benefitCategoryName,
          svc.stcCode,
          svc.serviceDescription,
          svc.copayAmount,
          svc.copayText,
          svc.coinsurancePercent,
          svc.notes,
        ],
      );
    }

    if (ownedClient) await client.query("COMMIT");
    return { resultId, serviceCount: benefitServices.length };
  } catch (e) {
    if (ownedClient) await client.query("ROLLBACK");
    throw e;
  } finally {
    if (ownedClient) client.release();
  }
}

/** @deprecated Use insertAvailityEligibilityBundle */
export async function insertAvailityResult(db, runId, row) {
  const bundle = {
    result: {
      coverageStatusText: row.coverageStatusText,
      isActive: row.isActive,
      memberId: row.memberId,
      payerId: row.payerId,
      patientNameOnFile: row.patientNameOnFile,
      dateOfBirth: row.dateOfBirth,
      dateOfService: row.dateOfService,
      transactionDate: row.transactionDate,
      transactionTime: row.transactionTime,
      transactionId: row.transactionId,
      customerId: row.customerId,
      insuranceType: row.insuranceType,
      planProduct: row.planProduct,
      coverageLevel: row.coverageLevel,
      groupNumber: row.groupNumber,
      groupName: row.groupName,
      planNumber: row.planNumber,
      planBeginDate: row.planBeginDate,
      eligibilityBeginDate: row.eligibilityBeginDate,
      annualDeductibleNetwork: row.annualDeductibleNetwork,
      annualDeductibleTotal: row.annualDeductibleTotal,
      annualDeductibleMet: row.annualDeductibleMet,
      annualDeductibleRemaining: row.annualDeductibleRemaining,
      oopNetwork: row.outOfPocketNetwork,
      oopTotal: row.outOfPocketTotal,
      oopMet: row.outOfPocketMet,
      oopRemaining: row.outOfPocketRemaining,
      benefitsJsonPath: null,
    },
    benefitServices: [],
    benefitsPayload: row.rawSnapshot || null,
  };
  const { resultId } = await insertAvailityEligibilityBundle(
    db,
    runId,
    row.patientId,
    bundle,
  );
  return resultId;
}
