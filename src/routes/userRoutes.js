const express = require("express");
const userController = require("../controllers/userController");
const { requireAuth } = require("../middlewares/authMiddleware");
const { requireAdmin } = require("../middlewares/adminMiddleware");

const r = express.Router();
r.get("/me", requireAuth, userController.getMe);
r.get("/credentials", requireAuth, userController.getCredentials);
r.post("/", requireAuth, requireAdmin, userController.createUser);
r.post("/credentials", requireAuth, userController.upsertUserCredentials);

module.exports = r;
