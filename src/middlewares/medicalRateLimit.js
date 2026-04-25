const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const m = require('../metrics/prometheus');
const { SERVICE, httpRateLimitBlocks } = m;
const { routeLabel } = require('./httpMetrics');

const limiter = rateLimit({
  windowMs: env.medicalRateLimit.windowMs,
  max: env.medicalRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const route = routeLabel(req);
    httpRateLimitBlocks.inc({ service: SERVICE, route });
    res.status(429).json({ message: 'Too many requests' });
  },
});

module.exports = { medicalRateLimit: limiter };
