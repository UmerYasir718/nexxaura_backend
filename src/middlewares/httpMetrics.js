const m = require('../metrics/prometheus');
const { SERVICE, httpInFlight, httpDuration, httpTotal } = m;
const { getRequestDbQueryCount } = require('../context/alsContext');
const env = require('../config/env');

function routeLabel(req) {
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  const u = (req.originalUrl || req.url || '/').split('?')[0];
  return u.length < 200 ? u : u.slice(0, 200);
}

function shouldSkip(req) {
  return req.path === '/metrics' || (req.path === '/health' && !process.env.METRICS_ON_HEALTH);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function httpMetrics(req, res, next) {
  if (shouldSkip(req)) {
    return next();
  }
  if (!env.metricsEnabled) {
    return next();
  }
  httpInFlight.inc({ service: SERVICE });
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    httpInFlight.dec({ service: SERVICE });
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    const route = routeLabel(req);
    res.locals.metricsRoute = route;
    const st = String(res.statusCode);
    const labels = { method: req.method, route, status: st, service: SERVICE };
    httpDuration.observe(labels, sec);
    httpTotal.inc(labels);
    const qn = getRequestDbQueryCount();
    m.requestDbQueryCount.observe({ route, method: req.method, service: SERVICE }, qn);
  });
  next();
}

module.exports = { httpMetrics, routeLabel };
