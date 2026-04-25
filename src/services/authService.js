const bcrypt = require('bcryptjs');
const db = require('../config/db');
const redis = require('../config/redis');
const { signAccessToken } = require('../utils/jwt');
const HttpError = require('../utils/httpError');

const TOKEN_PREFIX = 'auth:active:';

async function login(email, password) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1 AND is_active = true LIMIT 1', [email]);
  const user = rows[0];
  if (!user) throw new HttpError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new HttpError(401, 'Invalid email or password');

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  await redis.set(`${TOKEN_PREFIX}${token}`, user.id, 'EX', 60 * 60 * 12);

  return {
    token,
    user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
  };
}

async function isTokenActive(token) {
  const cached = await redis.get(`${TOKEN_PREFIX}${token}`);
  return Boolean(cached);
}

module.exports = { login, isTokenActive };
