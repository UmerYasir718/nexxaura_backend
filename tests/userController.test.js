jest.mock('../src/services/userService', () => ({
  createUserByAdmin: jest.fn(),
}));

jest.mock('../src/middlewares/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@nexxaura.com', role: 'admin' };
    next();
  },
}));

jest.mock('../src/middlewares/adminMiddleware', () => ({
  requireAdmin: (_req, _res, next) => next(),
}));

const request = require('supertest');
const app = require('../src/app');
const userService = require('../src/services/userService');

describe('POST /api/users (admin create user)', () => {
  it('returns 201 with created user payload', async () => {
    userService.createUserByAdmin.mockResolvedValue({
      id: 'new-1',
      email: 'staff1@clinic.com',
      fullName: 'Staff One',
      role: 'reception',
      createdAt: new Date().toISOString(),
      hasOfficeAllyCredentials: true,
      hasAvailityCredentials: false,
    });

    const res = await request(app)
      .post('/api/users')
      .send({
        email: 'staff1@clinic.com',
        fullName: 'Staff One',
        password: 'password1',
        role: 'reception',
        officeAlly: { username: 'oa1', password: 'oa1pass' },
      });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('reception');
    expect(res.body.hasOfficeAllyCredentials).toBe(true);
  });
});
