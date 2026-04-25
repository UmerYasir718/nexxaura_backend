const request = require('supertest');
const app = require('../src/app');

describe('gateway health', () => {
  it('GET /health is ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toMatch(/Nexxaura/);
  });
});
