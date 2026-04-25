const express = require('express');
const dataController = require('../controllers/dataController');
const { requireAuth } = require('../middlewares/authMiddleware');

const r = express.Router();
r.use(requireAuth);

r.get('/appointments', dataController.getAppointments);
r.get('/patients', dataController.getPatients);
r.get('/patient-insurance', dataController.getPatientInsurance);
r.get('/availity', dataController.getAvailitySummary);
r.get('/dashboard', dataController.getDashboard);

module.exports = r;
