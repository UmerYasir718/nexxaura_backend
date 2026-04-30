const env = require("../config/env");
const medicalUpstreamService = require("../services/medicalUpstreamService");
const {
  validateAudioFile,
  validateDiagnosisPdfBuffer,
  validateFileSizeBytes,
} = require("../validation/medicalRules");
const HttpError = require("../utils/httpError");

async function independentTranscribeAudio(req, res, next) {
  try {
    const v = validateAudioFile(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    const maxBytes = env.medicalLimits.maxAudioMb * 1024 * 1024;
    const s = validateFileSizeBytes(req.file, maxBytes);
    if (!s.ok) return res.status(s.status).json({ detail: s.message });
    return medicalUpstreamService.forwardMultipart("/api/independent/transcribe-audio", req.file, null, res);
  } catch (e) {
    return next(e);
  }
}

async function independentGenerateReport(req, res, next) {
  try {
    if (!req.body || !String(req.body.transcript || "").trim()) {
      return res.status(422).json({ detail: "transcript is required" });
    }
    return medicalUpstreamService.forwardJson("post", "/api/independent/generate-report", req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function independentParsePdf(req, res, next) {
  try {
    const v = validateDiagnosisPdfBuffer(req.file);
    if (!v.ok) return res.status(v.status).json({ detail: v.message });
    const maxBytes = env.medicalLimits.maxDiagnosisPdfMb * 1024 * 1024;
    const s = validateFileSizeBytes(req.file, maxBytes);
    if (!s.ok) return res.status(s.status).json({ detail: s.message });
    return medicalUpstreamService.forwardMultipart("/api/independent/parse-pdf", req.file, null, res);
  } catch (e) {
    return next(e);
  }
}

async function independentCodeIcd(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || "").trim()) {
      return res.status(422).json({ detail: "summary_report is required" });
    }
    return medicalUpstreamService.forwardJson("post", "/api/independent/code-icd", req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function independentCodeCpt(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || "").trim()) {
      return res.status(422).json({ detail: "summary_report is required" });
    }
    return medicalUpstreamService.forwardJson("post", "/api/independent/code-cpt", req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function independentDenialPrevention(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || "").trim()) {
      return res.status(422).json({ detail: "summary_report is required" });
    }
    if (!String(req.body.specialty || "").trim()) {
      return res.status(422).json({ detail: "specialty is required" });
    }
    if (!Array.isArray(req.body.codes)) {
      return res.status(422).json({ detail: "codes array is required" });
    }
    return medicalUpstreamService.forwardJson("post", "/api/independent/denial-prevention", req.body, res);
  } catch (e) {
    return next(e);
  }
}

async function independentRiskMitigation(req, res, next) {
  try {
    if (!req.body || !String(req.body.summary_report || "").trim()) {
      return res.status(422).json({ detail: "summary_report is required" });
    }
    if (!String(req.body.specialty || "").trim()) {
      return res.status(422).json({ detail: "specialty is required" });
    }
    if (!Array.isArray(req.body.codes)) {
      return res.status(422).json({ detail: "codes array is required" });
    }
    if (!req.body.denial_report || typeof req.body.denial_report !== "object") {
      return res.status(422).json({ detail: "denial_report object is required" });
    }
    return medicalUpstreamService.forwardJson("post", "/api/independent/risk-mitigation", req.body, res);
  } catch (e) {
    return next(e);
  }
}

function ensureMedicalBackendAvailable(_req, _res, next) {
  if (!env.medicalBackend.baseUrl) {
    return next(new HttpError(503, "Medical backend URL is not configured"));
  }
  return next();
}

module.exports = {
  independentTranscribeAudio,
  independentGenerateReport,
  independentParsePdf,
  independentCodeIcd,
  independentCodeCpt,
  independentDenialPrevention,
  independentRiskMitigation,
  ensureMedicalBackendAvailable,
};
