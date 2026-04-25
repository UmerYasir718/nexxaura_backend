const { verifyAccessToken } = require('../utils/jwt');
const authService = require('../services/authService');
const HttpError = require('../utils/httpError');

async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Missing Bearer token');

    const active = await authService.isTokenActive(token);
    if (!active) throw new HttpError(401, 'Token is not active');

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth };
