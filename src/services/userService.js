const bcrypt = require('bcryptjs');
const db = require('../config/db');
const HttpError = require('../utils/httpError');

const ROLES = new Set(['admin', 'doctor', 'staff', 'reception']);

function assertRole(role) {
  if (!ROLES.has(role)) {
    throw new HttpError(400, `role must be one of: ${[...ROLES].join(', ')}`);
  }
}

/**
 * Admin creates a new user. Office Ally / Availity blocks are optional; if present, username+password required for each.
 */
async function createUserByAdmin({
  email,
  fullName,
  password,
  role,
  officeAlly,
  availity,
}) {
  assertRole(role);
  if (role === 'admin') {
    throw new HttpError(400, 'Creating another admin through this API is not allowed');
  }
  const em = String(email || '').trim().toLowerCase();
  if (!em) throw new HttpError(400, 'email is required');
  if (!String(fullName || '').trim()) throw new HttpError(400, 'fullName is required');
  if (!password || String(password).length < 6) {
    throw new HttpError(400, 'password is required (min 6 characters)');
  }

  if (officeAlly != null) {
    if (!officeAlly.username || !officeAlly.password) {
      throw new HttpError(400, 'officeAlly requires both username and password when provided');
    }
  }
  if (availity != null) {
    if (!availity.username || !availity.password) {
      throw new HttpError(400, 'availity requires both username and password when provided');
    }
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO users (email, full_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, created_at`,
      [em, String(fullName).trim(), passwordHash, role],
    );
    const user = ins.rows[0];

    if (officeAlly) {
      await client.query(
        `INSERT INTO office_ally_credentials (user_id, username, password)
         VALUES ($1, $2, $3)`,
        [user.id, String(officeAlly.username).trim(), String(officeAlly.password)],
      );
    }
    if (availity) {
      await client.query(
        `INSERT INTO availity_credentials (user_id, username, password)
         VALUES ($1, $2, $3)`,
        [user.id, String(availity.username).trim(), String(availity.password)],
      );
    }
    await client.query('COMMIT');
    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      createdAt: user.created_at,
      hasOfficeAllyCredentials: Boolean(officeAlly),
      hasAvailityCredentials: Boolean(availity),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      throw new HttpError(409, 'Email already registered');
    }
    throw e;
  } finally {
    client.release();
  }
}

async function getUserById(id) {
  const { rows } = await db.query('SELECT id, email, full_name, role, is_active FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { createUserByAdmin, getUserById, ROLES: [...ROLES] };
