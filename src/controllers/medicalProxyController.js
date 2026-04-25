const env = require('../config/env');
const medicalUpstreamService = require('../services/medicalUpstreamService');
const {
  validateAudioFile,
  validateUploadTextPdfFile,
  validateDiagnosisPdfBuffer,
  validateFileSizeBytes,
} = require('../validation/medicalRules');
const HttpError = require('../utils/httpError');

async function upstreamRoot(_req, res, next) {
  try {
    return medicalUpstreamService.forwardGetRoot(res);
  } catch (e) {
    return next(e);
  }
}

async function transcribe(req, res, next) {
  try {
    const v = validateAudioFile(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    const maxBytes = env.medicalLimits.maxAudioMb * 1024 * 1024;
    const s = validateFileSizeBytes(req.file, maxBytes);
    if (!s.ok) return res.status(s.status).json({ detail: s.message });
    return medicalUpstreamService.forwardMultipart('/api/transcribe', req.file, null, res);
  } catch (e) {
    return next(e);
  }
}

async function downloadTranscriptionTxt(req, res, next) {
  try {
    if (!req.body || typeof req.body.content !== 'string') {
      return res.status(422).json({ detail: 'content is required' });
    }
    return medicalUpstreamService.forwardBinaryPost('/api/download/transcription-txt', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function downloadTranscriptionPdf(req, res, next) {
  try {
    if (!req.body || typeof req.body.content !== 'string') {
      return res.status(422).json({ detail: 'content is required' });
    }
    return medicalUpstreamService.forwardBinaryPost('/api/download/transcription-pdf', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function downloadReportTxt(req, res, next) {
  try {
    if (!req.body || typeof req.body.content !== 'string') {
      return res.status(422).json({ detail: 'content is required' });
    }
    return medicalUpstreamService.forwardBinaryPost('/api/download/report-txt', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function downloadReportPdf(req, res, next) {
  try {
    if (!req.body || typeof req.body.content !== 'string') {
      return res.status(422).json({ detail: 'content is required' });
    }
    return medicalUpstreamService.forwardBinaryPost('/api/download/report-pdf', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function assignCodes(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || '').trim()) {
      return res.status(422).json({ detail: 'summary_report is required' });
    }
    return medicalUpstreamService.forwardJson('post', '/api/coding/assign-codes', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function assignCodesStream(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || '').trim()) {
      return res.status(422).json({ detail: 'summary_report is required' });
    }
    return medicalUpstreamService.forwardStream('post', '/api/coding/assign-codes-stream', req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function uploadAndCode(req, res, next) {
  try {
    const v = validateUploadTextPdfFile(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    return medicalUpstreamService.forwardMultipart('/api/coding/upload-and-code', req.file, req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function uploadAndCodeStream(req, res, next) {
  try {
    const v = validateUploadTextPdfFile(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    return medicalUpstreamService.forwardMultipartStream('/api/coding/upload-and-code-stream', req.file, req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function uploadDiagnosisPdf(req, res, next) {
  try {
    const v = validateDiagnosisPdfBuffer(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    const maxBytes = env.medicalLimits.maxDiagnosisPdfMb * 1024 * 1024;
    const s = validateFileSizeBytes(req.file, maxBytes);
    if (!s.ok) return res.status(s.status).json({ detail: s.message });
    return medicalUpstreamService.forwardMultipart('/api/coding/upload-diagnosis-pdf', req.file, req.body, res);
  } catch (e) {
    return next(e);
  }
}

function ensureMedicalBackendAvailable(_req, _res, next) {
  if (!env.medicalBackend.baseUrl) {
    return next(new HttpError(503, 'Medical backend URL is not configured'));
  }
  return next();
}

module.exports = {
  upstreamRoot,
  transcribe,
  downloadTranscriptionTxt,
  downloadTranscriptionPdf,
  downloadReportTxt,
  downloadReportPdf,
  assignCodes,
  assignCodesStream,
  uploadAndCode,
  uploadAndCodeStream,
  uploadDiagnosisPdf,
  ensureMedicalBackendAvailable,
};
