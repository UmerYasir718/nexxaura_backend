const ExcelJS = require("exceljs");
const { remittanceEobRowsToXlsxBuffer } = require("../src/utils/remittanceEobExcel");

describe("remittanceEobRowsToXlsxBuffer", () => {
  it("writes a valid xlsx for empty rows", async () => {
    const buf = await remittanceEobRowsToXlsxBuffer([]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Remittance EOB");
    expect(ws).toBeTruthy();
    expect(ws.rowCount).toBe(1);
  });
});
