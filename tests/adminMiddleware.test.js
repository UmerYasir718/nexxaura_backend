jest.mock('../src/config/db', () => ({
  query: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { requireAdmin } = require('../src/middlewares/adminMiddleware');
const { errorMiddleware } = require('../src/middlewares/errorMiddleware');
const db = require('../src/config/db');

describe('requireAdmin', () => {
  it('forEach role case: 403 for non-admin, 200 for admin', async () => {
    const cases = [
      { role: 'staff', expectStatus: 403 },
      { role: 'doctor', expectStatus: 403 },
      { role: 'admin', expectStatus: 200 },
    ];

    for (const c of cases) {
      db.query.mockResolvedValueOnce({ rows: [{ role: c.role }] });
      const app = express();
      app.get(
        '/t',
        (req, _res, next) => {
          req.user = { id: 'u1' };
          next();
        },
        requireAdmin,
        (_req, res) => res.json({ ok: true }),
      );
      app.use(errorMiddleware);
      const res = await request(app).get('/t');
      expect(res.status).toBe(c.expectStatus);
    }
  });
});
