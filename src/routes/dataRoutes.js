const express = require('express');
const dataController = require('../controllers/dataController');
const { requireAuth } = require('../middlewares/authMiddleware');

const r = express.Router();
r.use(requireAuth);

r.post('/patient-insurance-eligibility-detail', dataController.postPatientInsuranceEligibilityDetail);

r.get('/appointments', dataController.getAppointments);
r.get('/patients', dataController.getPatients);
r.get('/patients/:patientId/appointments', dataController.getAppointmentsByPatient);
r.get('/patient-insurance', dataController.getPatientInsurance);
r.get('/patients/:patientId/insurance', dataController.getPatientInsuranceByPatient);
r.get('/availity', dataController.getAvailitySummary);
r.get('/patients/:patientId/availity', dataController.getAvailitySummaryByPatient);
r.get('/dashboard', dataController.getDashboard);

module.exports = r;
