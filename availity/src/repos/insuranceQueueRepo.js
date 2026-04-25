export async function listPrimaryInsuranceForAvaility(db, limit) {
  const r = await db.query(
    `SELECT
       p.id AS patient_id,
       p.pm_patient_id,
       to_char(p.date_of_birth::date, 'YYYY-MM-DD') AS date_of_birth,
       pi.coverage_rank,
       pi.payer_name,
       pi.member_id
     FROM patients p
     INNER JOIN patient_insurance pi
       ON pi.patient_id = p.id AND pi.coverage_rank = 1
     WHERE p.date_of_birth IS NOT NULL
       AND NULLIF(trim(pi.member_id), '') IS NOT NULL
       AND NULLIF(trim(pi.payer_name), '') IS NOT NULL
     ORDER BY p.last_synced_at DESC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  return r.rows;
}
