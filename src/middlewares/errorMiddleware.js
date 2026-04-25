const m = require('../metrics/prometheus');
const { SERVICE, httpAuthFailures } = m;
const { routeLabel } = require('./httpMetrics');
const AsyncTimeoutError = require('../utils/AsyncTimeoutError');

function errorMiddleware(error, req, res, _next) {
  if (error && (error.name === 'AsyncTimeoutError' || error instanceof AsyncTimeoutError)) {
    return res.status(504).json({ message: 'Gateway timeout', code: 'ETIMEDOUT' });
  }
  if (error && error.status === 401) {
    const route = routeLabel(req);
    httpAuthFailures.inc({ type: '401', service: SERVICE, route });
  }
  if (error && error.status === 403) {
    const route = routeLabel(req);
    httpAuthFailures.inc({ type: '403', service: SERVICE, route });
  }
  if (error.isAxiosError) {
    if (error.code === 'ECONNABORTED' || (error.message || '').toLowerCase().includes('timeout')) {
      return res.status(504).json({ detail: 'Upstream medical service timed out' });
    }
    const status = error.response?.status || 502;
    const data = error.response?.data;
    if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
      return res.status(status).json(data);
    }
    if (Buffer.isBuffer(data)) {
      return res.status(status).send(data);
    }
    return res.status(502).json({ detail: error.message || 'Upstream medical service unavailable' });
  }
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
}

module.exports = { errorMiddleware };
