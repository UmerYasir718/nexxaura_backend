const { runWithRequestContext } = require('../context/alsContext');

/**
 * @param {import('express').Request} _req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
function requestContextMiddleware(_req, _res, next) {
  return runWithRequestContext(() => {
    next();
  });
}

module.exports = { requestContextMiddleware };
