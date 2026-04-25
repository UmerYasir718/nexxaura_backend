const db = require('../config/db');
const HttpError = require('../utils/httpError');

/** Must run after requireAuth. Resolves current user role from DB. */
async function requireAdmin(req, _res, next) {
  try {
    const { rows } = await db.query("SELECT role FROM users WHERE id = $1 AND is_active = true LIMIT 1", [
      req.user.id,
    ]);
    if (!rows[0]) {
      return next(new HttpError(401, 'User not found'));
    }
    if (rows[0].role !== 'admin') {
      return next(new HttpError(403, 'Admin access required'));
    }
    req.user.role = 'admin';
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { requireAdmin };
