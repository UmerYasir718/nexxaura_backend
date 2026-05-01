const bcrypt = require("bcryptjs");
const db = require("../config/db");
const HttpError = require("../utils/httpError");

const ROLES = new Set(["admin", "doctor", "staff", "reception"]);

function assertRole(role) {
  if (!ROLES.has(role)) {
    throw new HttpError(400, `role must be one of: ${[...ROLES].join(", ")}`);
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
  if (role === "admin") {
    throw new HttpError(
      400,
      "Creating another admin through this API is not allowed",
    );
  }
  const em = String(email || "")
    .trim()
    .toLowerCase();
  if (!em) throw new HttpError(400, "email is required");
  if (!String(fullName || "").trim())
    throw new HttpError(400, "fullName is required");
  if (!password || String(password).length < 6) {
    throw new HttpError(400, "password is required (min 6 characters)");
  }

  if (officeAlly != null) {
    if (!officeAlly.username || !officeAlly.password) {
      throw new HttpError(
        400,
        "officeAlly requires both username and password when provided",
      );
    }
  }
  if (availity != null) {
    if (!availity.username || !availity.password) {
      throw new HttpError(
        400,
        "availity requires both username and password when provided",
      );
    }
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const client = await db.getClient();
  try {
    await client.query("BEGIN");
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
        [
          user.id,
          String(officeAlly.username).trim(),
          String(officeAlly.password),
        ],
      );
    }
    if (availity) {
      await client.query(
        `INSERT INTO availity_credentials (user_id, username, password)
         VALUES ($1, $2, $3)`,
        [
          user.id,
          String(availity.username).trim(),
          String(availity.password),
        ],
      );
    }
    await client.query("COMMIT");
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
    await client.query("ROLLBACK");
    if (e.code === "23505") {
      throw new HttpError(409, "Email already registered");
    }
    throw e;
  } finally {
    client.release();
  }
}

async function getUserById(id) {
  const { rows } = await db.query(
    "SELECT id, email, full_name, role, is_active FROM users WHERE id = $1",
    [id],
  );
  return rows[0] || null;
}

function normalizeCredentialPayload(payload) {
  const p = payload || {};
  const companyName = String(p.companyName || "").trim();
  const title = String(p.title || "").trim();
  const description = String(p.description || "").trim();
  const name = String(p.name || "").trim();
  const officeallyusernameOrEmail = String(p.officeallyusernameOrEmail || "").trim();
  const availityusernameOrEmail = String(p.availityusernameOrEmail || "").trim();
  const officeallyPassword = String(p.officeallyPassword || "");
  const availityPassword = String(p.availityPassword || "");
  const password = String(p.password || "");

  if (!companyName) throw new HttpError(400, "companyName is required");
  if (!title) throw new HttpError(400, "title is required");
  if (!description) throw new HttpError(400, "description is required");
  if (!name) throw new HttpError(400, "name is required");
  if (!officeallyusernameOrEmail) {
    throw new HttpError(400, "officeallyusernameOrEmail is required");
  }
  if (!availityusernameOrEmail) {
    throw new HttpError(400, "availityusernameOrEmail is required");
  }
  if (!officeallyPassword && !password) {
    throw new HttpError(400, "officeallyPassword is required");
  }
  if (!availityPassword && !password) {
    throw new HttpError(400, "availityPassword is required");
  }

  return {
    companyName,
    title,
    description,
    name,
    officeallyusernameOrEmail,
    availityusernameOrEmail,
    officeallyPassword,
    availityPassword,
    password,
  };
}

async function assertUserExists(userId) {
  const { rows } = await db.query("SELECT id FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!rows[0]) throw new HttpError(404, "user not found");
}

async function upsertOfficeAllyCredentials(userId, payload) {
  await assertUserExists(userId);
  const d = normalizeCredentialPayload(payload);
  if (!d.officeallyusernameOrEmail) {
    throw new HttpError(400, "officeallyusernameOrEmail is required");
  }
  await db.query(
    `INSERT INTO office_ally_credentials
      (user_id, company_name, title, description, name, username, password, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      password = EXCLUDED.password,
      updated_at = NOW()`,
    [
      userId,
      d.companyName,
      d.title,
      d.description,
      d.name,
      d.officeallyusernameOrEmail,
      d.password,
    ],
  );
  return { userId, provider: "office_ally", saved: true };
}

async function upsertAvailityCredentials(userId, payload) {
  await assertUserExists(userId);
  const d = normalizeCredentialPayload(payload);
  if (!d.availityusernameOrEmail) {
    throw new HttpError(400, "availityusernameOrEmail is required");
  }
  await db.query(
    `INSERT INTO availity_credentials
      (user_id, company_name, title, description, name, username, password, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      password = EXCLUDED.password,
      updated_at = NOW()`,
    [
      userId,
      d.companyName,
      d.title,
      d.description,
      d.name,
      d.availityusernameOrEmail,
      d.password,
    ],
  );
  return { userId, provider: "availity", saved: true };
}

async function upsertUserCredentials(userId, payload) {
  const normalized = normalizeCredentialPayload(payload);
  await assertUserExists(userId);

  const oaPassword = normalized.officeallyPassword || normalized.password;
  const avPassword = normalized.availityPassword || normalized.password;

  await db.query(
    `INSERT INTO office_ally_credentials
      (user_id, company_name, title, description, name, username, password, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      password = EXCLUDED.password,
      updated_at = NOW()`,
    [
      userId,
      normalized.companyName,
      normalized.title,
      normalized.description,
      normalized.name,
      normalized.officeallyusernameOrEmail,
      oaPassword,
    ],
  );

  await db.query(
    `INSERT INTO availity_credentials
      (user_id, company_name, title, description, name, username, password, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      password = EXCLUDED.password,
      updated_at = NOW()`,
    [
      userId,
      normalized.companyName,
      normalized.title,
      normalized.description,
      normalized.name,
      normalized.availityusernameOrEmail,
      avPassword,
    ],
  );

  return {
    userId,
    saved: true,
    providers: ["office_ally", "availity"],
  };
}

module.exports = {
  createUserByAdmin,
  getUserById,
  upsertOfficeAllyCredentials,
  upsertAvailityCredentials,
  upsertUserCredentials,
  ROLES: [...ROLES],
};
