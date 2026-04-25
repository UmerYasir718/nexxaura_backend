jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/config/db');
const dataService = require('../src/services/dataService');

describe('dataService (user-scoped; forEach over users)', () => {
  const users = [
    { id: '11111111-1111-1111-1111-111111111111', label: 'user-a' },
    { id: '22222222-2222-2222-2222-222222222222', label: 'user-b' },
  ];

  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [] });
  });

  it('each list* call binds only that user id', async () => {
    for (const u of users) {
      await dataService.listPatients(u.id);
    }
    expect(db.query).toHaveBeenCalledTimes(2);
    [users[0].id, users[1].id].forEach((id, i) => {
      expect(db.query.mock.calls[i][1]).toEqual([id]);
    });
  });
});
