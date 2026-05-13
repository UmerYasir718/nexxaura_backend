const ExcelJS = require("exceljs");

function cellDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cellNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>[]} rows — query rows (snake_case + dob)
 * @returns {Promise<Buffer>}
 */
async function remittanceEobRowsToXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Remittance EOB");

  ws.columns = [
    { header: "Claim No", key: "claim_no", width: 14 },
    { header: "Patient Name", key: "patient_name", width: 22 },
    { header: "DOB", key: "dob", width: 12 },
    { header: "Primary Insured ID", key: "primary_insured_id", width: 18 },
    { header: "Office Ally", key: "office_ally", width: 14 },
    { header: "DOS", key: "dos", width: 12 },
    { header: "Work Status", key: "work_status", width: 12 },
    { header: "Insurance", key: "insurance", width: 18 },
    { header: "Total Charges", key: "total_charges", width: 14 },
    { header: "Allowed Amount", key: "allowed_amount", width: 14 },
    { header: "Primary Paid", key: "primary_paid", width: 14 },
    { header: "Patient Responsibility", key: "patient_responsibility", width: 18 },
    { header: "Adjustment", key: "adjustment", width: 12 },
    { header: "Balance", key: "balance", width: 12 },
    { header: "CHK/EFT", key: "chk_eft", width: 12 },
    { header: "CHK/EFT Date", key: "chk_eft_date", width: 14 },
    { header: "Remittance Status", key: "remittance_status", width: 16 },
    { header: "Remittance Sub-Status", key: "remittance_sub_status", width: 20 },
    { header: "Action", key: "action", width: 12 },
    { header: "Remarks", key: "remarks", width: 24 },
    { header: "Row ID", key: "id", width: 38 },
    { header: "File ID", key: "file_id", width: 38 },
    { header: "Source Row Index", key: "source_row_index", width: 16 },
    { header: "Created At", key: "created_at", width: 22 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ];

  for (const r of rows) {
    ws.addRow({
      claim_no: r.claim_no ?? "",
      patient_name: r.patient_name ?? "",
      dob: cellDate(r.dob),
      primary_insured_id: r.primary_insured_id ?? "",
      office_ally: r.office_ally ?? "",
      dos: cellDate(r.dos),
      work_status: r.work_status ?? "",
      insurance: r.insurance ?? "",
      total_charges: cellNum(r.total_charges),
      allowed_amount: cellNum(r.allowed_amount),
      primary_paid: cellNum(r.primary_paid),
      patient_responsibility: cellNum(r.patient_responsibility),
      adjustment: cellNum(r.adjustment),
      balance: cellNum(r.balance),
      chk_eft: r.chk_eft ?? "",
      chk_eft_date: cellDate(r.chk_eft_date),
      remittance_status: r.remittance_status ?? "",
      remittance_sub_status: r.remittance_sub_status ?? "",
      action: r.action ?? "",
      remarks: r.remarks ?? "",
      id: r.id ?? "",
      file_id: r.file_id ?? "",
      source_row_index:
        r.source_row_index == null ? "" : Number(r.source_row_index),
      created_at: cellDate(r.created_at),
      updated_at: cellDate(r.updated_at),
    });
  }

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

module.exports = { remittanceEobRowsToXlsxBuffer };
