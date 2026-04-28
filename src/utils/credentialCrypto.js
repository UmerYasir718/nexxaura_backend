const crypto = require('node:crypto');
const env = require('../config/env');

const PREFIX = 'enc:v1:';

function deriveKey() {
  if (env.credentialsEncryptionKey) {
    return crypto.createHash('sha256').update(String(env.credentialsEncryptionKey)).digest();
  }
  return crypto.createHash('sha256').update(String(env.jwtSecret || 'dev-secret')).digest();
}

function encryptCredentialPassword(plainText) {
  const iv = crypto.randomBytes(12);
  const key = deriveKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptCredentialPassword(value) {
  const raw = String(value || '');
  if (!raw.startsWith(PREFIX)) {
    // Backward compatibility: older rows were stored as plain text.
    return raw;
  }
  const [, ivB64, tagB64, dataB64] = raw.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted credential payload');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

module.exports = { encryptCredentialPassword, decryptCredentialPassword };
