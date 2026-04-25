const express = require('express');
const syncController = require('../controllers/syncController');
const otpController = require('../controllers/otpController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();
router.post('/date-sync', requireAuth, syncController.createDateSync);
router.post('/eligibility-verification', requireAuth, syncController.createEligibilityVerification);
router.post('/eligibilityandinsurance', requireAuth, syncController.createEligibilityAndInsurance);
router.post('/otp', requireAuth, otpController.submitOtp);
router.get('/runs', requireAuth, syncController.getMyRuns);
router.get('/runs/:id', requireAuth, syncController.getRunById);

module.exports = router;
