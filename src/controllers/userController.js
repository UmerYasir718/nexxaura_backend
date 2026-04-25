const userService = require('../services/userService');
const HttpError = require('../utils/httpError');

async function createUser(req, res, next) {
  try {
    const { email, fullName, password, role, officeAlly, availity } = req.body || {};
    if (role === undefined || role === null) {
      throw new HttpError(400, 'role is required (doctor, staff, or reception)');
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

module.exports = { createUser };
