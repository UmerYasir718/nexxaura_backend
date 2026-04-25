const express = require('express');
const userController = require('../controllers/userController');
const { requireAuth } = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/adminMiddleware');

const r = express.Router();
r.post('/', requireAuth, requireAdmin, userController.createUser);

module.exports = r;
