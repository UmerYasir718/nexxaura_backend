jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/pipelineService', () => ({
  runEndToEndSync: jest.fn(),
  runOfficeAllyStage: jest.fn(),
  runAvailityStage: jest.fn(),
}));

const db = require('../src/config/db');
const pipelineService = require('../src/services/pipelineService');
const syncService = require('../src/services/syncService');

describe('syncService date sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    pipelineService.runEndToEndSync.mockReset();
    pipelineService.runOfficeAllyStage.mockReset();
    pipelineService.runAvailityStage.mockReset();
  });

  it('runs only Office Ally and returns status/count', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'oa-user', password: 'oa-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    pipelineService.runOfficeAllyStage.mockResolvedValue({ savedAppointments: 3, rawAppointments: [] });

    const result = await syncService.runDateSyncOnly({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    });

    expect(result).toEqual({
      status: 'good',
      message: 'Office Ally date sync completed',
      savedAppointments: 3,
    });
    expect(pipelineService.runOfficeAllyStage).toHaveBeenCalledWith({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
      syncId: 'sync-1',
      officeAllyCreds: { username: 'oa-user', password: 'oa-pass' },
    });
    expect(pipelineService.runAvailityStage).not.toHaveBeenCalled();
    expect(pipelineService.runEndToEndSync).not.toHaveBeenCalled();
  });

  it('returns active run conflict without starting background work', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'oa-user', password: 'oa-pass' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'sync-active', status: 'running', message: 'Office Ally running' }],
      });

    const result = await syncService.runDateSyncOnly({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    });

    expect(result).toEqual({
      alreadyProcessing: true,
      syncRequestId: 'sync-active',
      status: 'running',
      message: 'Office Ally running',
    });
    expect(pipelineService.runOfficeAllyStage).not.toHaveBeenCalled();
    expect(pipelineService.runAvailityStage).not.toHaveBeenCalled();
  });

  it('returns status/count when latest scrape saves no appointments', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'oa-user', password: 'oa-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    pipelineService.runOfficeAllyStage.mockResolvedValue({
      savedAppointments: 0,
      rawAppointments: [],
    });

    const result = await syncService.runDateSyncOnly({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    });

    expect(result).toEqual({
      status: 'good',
      message: 'Office Ally date sync completed',
      savedAppointments: 0,
    });
  });

  it('marks the sync failed if Office Ally save fails', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'oa-user', password: 'oa-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-1' }] })
      .mockResolvedValue({ rows: [] });
    pipelineService.runOfficeAllyStage.mockRejectedValue(new Error('Office Ally failed'));

    await expect(syncService.runDateSyncOnly({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    })).rejects.toThrow('Office Ally failed');

    expect(db.query).toHaveBeenLastCalledWith(
      "UPDATE sync_requests SET status = 'failed', message = $2, finished_at = NOW() WHERE id = $1",
      ['sync-1', 'Office Ally failed'],
    );
  });

  it('runs Availity verification by appointment date and returns good status', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'av-user', password: 'av-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-2' }] });
    pipelineService.runAvailityStage.mockResolvedValue({
      processed: 2,
      successCount: 1,
      results: [{ status: 'success' }, { status: 'failed' }],
    });

    const result = await syncService.runEligibilityVerification({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    });

    expect(result).toEqual({
      status: 'good',
      message: 'Eligibility verification completed',
      processed: 2,
      successCount: 1,
      failedCount: 1,
    });
    expect(pipelineService.runAvailityStage).toHaveBeenCalledWith({
      userId: 'user-1',
      syncId: 'sync-2',
      availityCreds: { username: 'av-user', password: 'av-pass' },
      appointmentDate: '2026-04-24',
      officeAllySavedAppointments: null,
    });
    expect(pipelineService.runOfficeAllyStage).not.toHaveBeenCalled();
  });

  it('combined endpoint runs Office Ally then Availity by date', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ username: 'oa-user', password: 'oa-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-date' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ username: 'av-user', password: 'av-pass' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'sync-eligibility' }] });
    pipelineService.runOfficeAllyStage.mockResolvedValue({
      savedAppointments: 1,
      rawAppointments: [],
    });
    pipelineService.runAvailityStage.mockResolvedValue({
      processed: 1,
      successCount: 1,
      results: [{ status: 'success' }],
    });

    const result = await syncService.runEligibilityAndInsurance({
      userId: 'user-1',
      appointmentDate: '2026-04-24',
    });

    expect(result.status).toBe('good');
    expect(result.message).toBe('Eligibility and insurance completed');
    expect(result.savedAppointments).toBe(1);
    expect(result.eligibility).toEqual({
      status: 'good',
      message: 'Eligibility verification completed',
      processed: 1,
      successCount: 1,
      failedCount: 0,
    });
    expect(pipelineService.runAvailityStage).toHaveBeenCalledWith({
      userId: 'user-1',
      syncId: 'sync-eligibility',
      availityCreds: { username: 'av-user', password: 'av-pass' },
      appointmentDate: '2026-04-24',
      officeAllySavedAppointments: null,
    });
  });
});
