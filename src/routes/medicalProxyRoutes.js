const express = require('express');
const multer = require('multer');
const medical = require('../controllers/medicalProxyController');
const { medicalRateLimit } = require('../middlewares/medicalRateLimit');

const upload = multer({ storage: multer.memoryStorage() });
const r = express.Router();

r.use(medicalRateLimit);
r.use(medical.ensureMedicalBackendAvailable);

r.get('/', medical.upstreamRoot);

r.post('/api/transcribe', upload.single('file'), medical.transcribe);
r.post('/api/download/transcription-txt', express.json({ limit: '20mb' }), medical.downloadTranscriptionTxt);
r.post('/api/download/transcription-pdf', express.json({ limit: '20mb' }), medical.downloadTranscriptionPdf);
r.post('/api/download/report-txt', express.json({ limit: '20mb' }), medical.downloadReportTxt);
r.post('/api/download/report-pdf', express.json({ limit: '20mb' }), medical.downloadReportPdf);

r.post('/api/coding/assign-codes', express.json({ limit: '5mb' }), medical.assignCodes);
r.post('/api/coding/assign-codes-stream', express.json({ limit: '5mb' }), medical.assignCodesStream);

r.post(
  '/api/coding/upload-and-code',
  upload.single('file'),
  medical.uploadAndCode,
);
r.post(
  '/api/coding/upload-and-code-stream',
  upload.single('file'),
  medical.uploadAndCodeStream,
);
r.post(
  '/api/coding/upload-diagnosis-pdf',
  upload.single('file'),
  medical.uploadDiagnosisPdf,
);

module.exports = r;
