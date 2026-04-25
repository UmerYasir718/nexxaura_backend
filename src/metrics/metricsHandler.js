const env = require('../config/env');
const { getMetricsRegister } = require('./prometheus');

/**
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 */
async function metricsHandler(_req, res) {
  if (!env.metricsEnabled) {
    return res.status(404).end();
  }
  res.set('Content-Type', getMetricsRegister().contentType);
  return res.end(await getMetricsRegister().metrics());
}

module.exports = { metricsHandler };
