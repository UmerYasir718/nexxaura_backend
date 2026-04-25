jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/config/redis', () => ({
  set: jest.fn(),
  get: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const authService = require('../src/services/authService');

describe('authService', () => {
  it('logs in valid user', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'demo@nexxaura.com', full_name: 'Demo', role: 'doctor', password_hash: hash }],
    });

    const result = await authService.login('demo@nexxaura.com', 'secret123');

    expect(result.user.id).toBe('u1');
    expect(result.user.role).toBe('doctor');
    expect(result.token).toBeTruthy();
  });
});
