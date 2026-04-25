const axios = require('axios');
const FormData = require('form-data');
const env = require('../config/env');
const m = require('../metrics/prometheus');
const { SERVICE } = m;

const TARGET = 'medical_backend';

function upstreamHeaders(extra = {}) {
  const h = { ...extra };
  if (env.medicalBackend.apiKey) {
    h.Authorization = `Bearer ${env.medicalBackend.apiKey}`;
  }
  return h;
}

/**
 * @param {import('axios').AxiosRequestConfig} conf
 * @param {string} [statusOnErr]
 */
async function requestWithTimeout(conf, statusOnErr = 'error') {
  const t0 = process.hrtime.bigint();
  const timeoutMs = conf.timeout != null ? conf.timeout : env.medicalBackend.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  const merged = { ...conf, signal: controller.signal, timeout: timeoutMs };
  try {
    const r = await axios(merged);
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    m.httpUpstreamDuration.observe(
      { target: TARGET, status: String(r.status), service: SERVICE },
      sec,
    );
    return r;
  } catch (e) {
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    const isTimeout =
      e &&
      (e.code === 'ECONNABORTED' ||
        e.name === 'CanceledError' ||
        (e.name === 'AxiosError' && (e.message || '').toLowerCase().includes('timeout')));
    if (isTimeout || (e && e.code === 'ETIMEDOUT')) {
      m.httpUpstreamTimeout.inc({ target: TARGET, service: SERVICE });
    }
    const st = e && e.response && e.response.status != null ? String(e.response.status) : statusOnErr;
    m.httpUpstreamDuration.observe({ target: TARGET, status: st, service: SERVICE }, sec);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function forwardJson(method, path, data, res) {
  const url = `${env.medicalBackend.baseUrl}${path}`;
  const r = await requestWithTimeout({
    method,
    url,
    data: data === undefined ? undefined : data,
    headers: upstreamHeaders({ 'content-type': 'application/json' }),
    validateStatus: () => true,
  });
  res.status(r.status);
  if (r.headers['content-type']) {
    res.setHeader('content-type', r.headers['content-type']);
  }
  if (typeof r.data === 'string') {
    return res.send(r.data);
  }
  return res.json(r.data);
}

async function forwardStream(method, path, data, res) {
  const url = `${env.medicalBackend.baseUrl}${path}`;
  const r = await requestWithTimeout({
    method,
    url,
    data: data === undefined ? undefined : data,
    responseType: 'stream',
    headers: upstreamHeaders({ 'content-type': 'application/json' }),
    validateStatus: () => true,
  });
  res.status(r.status);
  const pass = ['content-type', 'cache-control', 'connection'];
  for (const k of pass) {
    if (r.headers[k]) res.setHeader(k, r.headers[k]);
  }
  r.data.pipe(res);
}

/** multipart: field file + optional text fields from req.body */
async function forwardMultipart(path, file, bodyFields, res) {
  const form = new FormData();
  form.append('file', file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });
  if (bodyFields) {
    Object.keys(bodyFields).forEach((key) => {
      if (bodyFields[key] == null || bodyFields[key] === '') return;
      form.append(key, String(bodyFields[key]));
    });
  }
  const url = `${env.medicalBackend.baseUrl}${path}`;
  const r = await requestWithTimeout({
    method: 'post',
    url,
    data: form,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: { ...form.getHeaders(), ...upstreamHeaders() },
    validateStatus: () => true,
  });
  return sendAxiosResponseJson(r, res);
}

/** multipart with stream response (SSE) */
async function forwardMultipartStream(path, file, bodyFields, res) {
  const form = new FormData();
  form.append('file', file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });
  if (bodyFields) {
    Object.keys(bodyFields).forEach((key) => {
      if (bodyFields[key] == null || bodyFields[key] === '') return;
      form.append(key, String(bodyFields[key]));
    });
  }
  const url = `${env.medicalBackend.baseUrl}${path}`;
  const r = await requestWithTimeout({
    method: 'post',
    url,
    data: form,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    responseType: 'stream',
    headers: { ...form.getHeaders(), ...upstreamHeaders() },
    validateStatus: () => true,
  });
  res.status(r.status);
  if (r.headers['content-type']) {
    res.setHeader('content-type', r.headers['content-type']);
  }
  r.data.pipe(res);
}

function sendAxiosResponseJson(r, res) {
  res.status(r.status);
  if (r.headers['content-type'] && r.headers['content-type'].includes('application/json')) {
    return res.json(r.data);
  }
  if (typeof r.data === 'string') {
    return res.send(r.data);
  }
  return res.json(r.data);
}

async function forwardGetRoot(res) {
  const url = `${env.medicalBackend.baseUrl}/`;
  const r = await requestWithTimeout(
    { method: 'get', url, timeout: env.medicalBackend.healthTimeoutMs, validateStatus: () => true },
    'error',
  );
  return sendAxiosResponseJson(r, res);
}

async function forwardBinaryPost(path, body, res) {
  const url = `${env.medicalBackend.baseUrl}${path}`;
  const r = await requestWithTimeout({
    method: 'post',
    url,
    data: body,
    responseType: 'arraybuffer',
    headers: upstreamHeaders({ 'content-type': 'application/json' }),
    validateStatus: () => true,
  });
  res.status(r.status);
  if (r.headers['content-type']) res.setHeader('content-type', r.headers['content-type']);
  if (r.headers['content-disposition']) res.setHeader('content-disposition', r.headers['content-disposition']);
  return res.send(Buffer.from(r.data));
}

module.exports = {
  forwardJson,
  forwardStream,
  forwardBinaryPost,
  forwardMultipart,
  forwardMultipartStream,
  forwardGetRoot,
  upstreamHeaders,
  requestWithTimeout,
};
