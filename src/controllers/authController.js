const authService = require('../services/authService');
const HttpError = require('../utils/httpError');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new HttpError(400, 'email and password are required');
    const result = await authService.login(email, password);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { login };
