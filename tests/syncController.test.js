jest.mock('../src/services/syncService', () => ({
  requestDateSyncOnly: jest.fn(),
  requestEligibilityVerification: jest.fn(),
  runEligibilityAndInsurance: jest.fn(),
  getRunsByUser: jest.fn(),
  getRunByIdForUser: jest.fn(),
}));

jest.mock('../src/middlewares/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'u1', email: 'demo@nexxaura.com' };
    next();
  },
}));

const request = require('supertest');
const app = require('../src/app');
const syncService = require('../src/services/syncService');

describe('sync controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 202 when date sync is queued', async () => {
    syncService.requestDateSyncOnly.mockResolvedValue({
      syncRequestId: 'sync-1',
      message: 'Date sync started',
    });

    const response = await request(app).post('/api/sync/date-sync').send({ appointmentDate: '2026-04-24' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      status: 'good',
      message: 'Date sync started',
      syncRequestId: 'sync-1',
    });
    expect(syncService.requestDateSyncOnly).toHaveBeenCalledWith({
      userId: 'u1',
      appointmentDate: '2026-04-24',
    });
  });

  it('returns 409 when sync already in progress', async () => {
    syncService.requestDateSyncOnly.mockResolvedValue({
      alreadyProcessing: true,
      syncRequestId: 'r0',
      status: 'running',
      message: 'busy',
    });

    const response = await request(app).post('/api/sync/date-sync').send({ appointmentDate: '2026-04-25' });

    expect(response.status).toBe(409);
    expect(response.body.syncRequestId).toBe('r0');
  });

  it('returns 202 when eligibility verification is queued', async () => {
    syncService.requestEligibilityVerification.mockResolvedValue({
      syncRequestId: 'sync-elig-1',
      message: 'Eligibility verification started',
    });

    const response = await request(app).post('/api/sync/eligibility-verification').send({ appointmentDate: '2026-04-24' });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('good');
    expect(response.body.message).toBe('Eligibility verification started');
    expect(response.body.syncRequestId).toBe('sync-elig-1');
    expect(syncService.requestEligibilityVerification).toHaveBeenCalledWith({
      userId: 'u1',
      appointmentDate: '2026-04-24',
    });
  });

  it('runs combined eligibility and insurance endpoint separately', async () => {
    syncService.runEligibilityAndInsurance.mockResolvedValue({
      status: 'good',
      message: 'Eligibility and insurance completed',
      officeAlly: { savedAppointments: 1 },
      eligibility: { processed: 1, successCount: 1, failedCount: 0 },
    });

    const response = await request(app).post('/api/sync/eligibilityandinsurance').send({ appointmentDate: '2026-04-24' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('good');
    expect(response.body.message).toBe('Eligibility and insurance completed');
    expect(syncService.runEligibilityAndInsurance).toHaveBeenCalledWith({
      userId: 'u1',
      appointmentDate: '2026-04-24',
    });
  });
});
