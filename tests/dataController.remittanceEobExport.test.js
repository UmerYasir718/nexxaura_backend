jest.mock("../src/middlewares/authMiddleware", () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: "u1", email: "demo@nexxaura.com", role: "staff" };
    next();
  },
}));

const request = require("supertest");
const dataService = require("../src/services/dataService");
const app = require("../src/app");

describe("GET /api/data/availity-claim-remittance-eob-export", () => {
  beforeEach(() => {
    jest
      .spyOn(dataService, "exportAvailityRemittanceEobRowsForUserExcelBuffer")
      .mockResolvedValue(
        Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns spreadsheet attachment for authenticated user", async () => {
    const res = await request(app).get(
      "/api/data/availity-claim-remittance-eob-export",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
    );
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(
      /availity-claim-remittance-eob-/,
    );
    expect(
      dataService.exportAvailityRemittanceEobRowsForUserExcelBuffer,
    ).toHaveBeenCalledWith("u1");
  });
});
