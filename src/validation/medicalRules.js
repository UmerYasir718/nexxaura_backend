const path = require('path');

const AUDIO_EXT = new Set(['.flac', '.m4a', '.mp3', '.ogg', '.wav', '.webm']);
const TEXT_PDF_EXT = new Set(['.txt', '.pdf']);

function extOf(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function validateAudioFile(file) {
  if (!file) return { ok: false, status: 400, message: 'file is required' };
  if (file.size <= 0) return { ok: false, status: 400, message: 'file is empty' };
  const ext = extOf(file.originalname);
  if (!AUDIO_EXT.has(ext)) {
    return {
      ok: false,
      status: 400,
      message: `Invalid audio extension. Allowed: ${[...AUDIO_EXT].join(', ')}`,
    };
  }
  return { ok: true };
}

function validateUploadTextPdfFile(file) {
  if (!file) return { ok: false, status: 400, message: 'file is required' };
  if (file.size <= 0) return { ok: false, status: 400, message: 'file is empty' };
  const ext = extOf(file.originalname);
  if (!TEXT_PDF_EXT.has(ext)) {
    return { ok: false, status: 400, message: 'File must be .txt or .pdf' };
  }
  return { ok: true };
}

function validateDiagnosisPdfBuffer(file) {
  if (!file) return { ok: false, status: 400, message: 'file is required' };
  if (file.size <= 0) return { ok: false, status: 400, message: 'file is empty' };
  if (extOf(file.originalname) !== '.pdf') {
    return { ok: false, status: 400, message: 'A PDF file is required' };
  }
  if (!file.buffer || file.buffer.length < 4) {
    return { ok: false, status: 400, message: 'File too small' };
  }
  const h = file.buffer.subarray(0, 4).toString('latin1');
  if (h !== '%PDF') {
    return { ok: false, status: 400, message: 'File does not look like a valid PDF (missing %PDF header)' };
  }
  return { ok: true };
}

function validateFileSizeBytes(file, maxBytes) {
  if (file && file.size > maxBytes) {
    return { ok: false, status: 400, message: `File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB)` };
  }
  return { ok: true };
}

module.exports = {
  AUDIO_EXT,
  TEXT_PDF_EXT,
  extOf,
  validateAudioFile,
  validateUploadTextPdfFile,
  validateDiagnosisPdfBuffer,
  validateFileSizeBytes,
};
