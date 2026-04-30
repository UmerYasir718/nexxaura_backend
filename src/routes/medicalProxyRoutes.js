const express = require('express');
const multer = require('multer');
const medical = require('../controllers/medicalProxyController');
const { medicalRateLimit } = require('../middlewares/medicalRateLimit');

const upload = multer({ storage: multer.memoryStorage() });
const r = express.Router();

r.use(medicalRateLimit);
r.use(medical.ensureMedicalBackendAvailable);

r.post('/api/independent/transcribe-audio', upload.single('file'), medical.independentTranscribeAudio);
r.post('/api/independent/generate-report', express.json({ limit: '20mb' }), medical.independentGenerateReport);
r.post('/api/independent/parse-pdf', upload.single('file'), medical.independentParsePdf);
r.post('/api/independent/code-icd', express.json({ limit: '20mb' }), medical.independentCodeIcd);
r.post('/api/independent/code-cpt', express.json({ limit: '20mb' }), medical.independentCodeCpt);
r.post('/api/independent/denial-prevention', express.json({ limit: '20mb' }), medical.independentDenialPrevention);
r.post('/api/independent/risk-mitigation', express.json({ limit: '20mb' }), medical.independentRiskMitigation);

module.exports = r;
