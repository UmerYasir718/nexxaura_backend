const userService = require("../services/userService");
const HttpError = require("../utils/httpError");

async function createUser(req, res, next) {
  try {
    const { email, fullName, password, role, officeAlly, availity } =
      req.body || {};
    if (role === undefined || role === null) {
      throw new HttpError(
        400,
        "role is required (doctor, staff, or reception)",
      );
    }
    const created = await userService.createUserByAdmin({
      email,
      fullName,
      password,
      role,
      officeAlly,
      availity,
    });
    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
}

async function upsertOfficeAllyCredentials(req, res, next) {
  try {
    const { userId } = req.params;
    const saved = await userService.upsertOfficeAllyCredentials(userId, req.body || {});
    return res.status(200).json(saved);
  } catch (e) {
    return next(e);
  }
}

async function upsertAvailityCredentials(req, res, next) {
  try {
    const { userId } = req.params;
    const saved = await userService.upsertAvailityCredentials(userId, req.body || {});
    return res.status(200).json(saved);
  } catch (e) {
    return next(e);
  }
}

async function upsertUserCredentials(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      throw new HttpError(401, "Unauthorized");
    }
    const saved = await userService.upsertUserCredentials(userId, req.body || {});
    return res.status(200).json(saved);
  } catch (e) {
    return next(e);
  }
}

async function getMe(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      throw new HttpError(401, "Unauthorized");
    }
    const user = await userService.getUserById(userId);
    if (!user) {
      throw new HttpError(404, "user not found");
    }
    return res.status(200).json({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    });
  } catch (e) {
    return next(e);
  }
}

async function getCredentials(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      throw new HttpError(401, "Unauthorized");
    }
    const body = await userService.getCredentialsSummaryForUser(userId);
    return res.status(200).json(body);
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  createUser,
  upsertOfficeAllyCredentials,
  upsertAvailityCredentials,
  upsertUserCredentials,
  getMe,
  getCredentials,
};
