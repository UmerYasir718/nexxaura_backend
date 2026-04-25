const {
  validateAudioFile,
  validateUploadTextPdfFile,
  validateDiagnosisPdfBuffer,
  validateFileSizeBytes,
  AUDIO_EXT,
} = require('../src/validation/medicalRules');

const baseFile = (name, size, buffer) => ({
  originalname: name,
  size,
  mimetype: 'application/octet-stream',
  buffer: buffer || Buffer.alloc(size),
});

describe('medicalRules (table-driven)', () => {
  test.each([
    ['x.wav', 1, true],
    ['X.WAV', 100, true],
    ['a.mp3', 1, true],
    ['x.exe', 1, false],
    ['x', 0, false],
  ])('validateAudioFile %s size %i -> ok=%s', (name, size, expectOk) => {
    const r = validateAudioFile(size === 0 ? null : baseFile(name, size));
    expect(r.ok).toBe(expectOk);
  });

  test('validateAudioFile rejects disallowed extension', () => {
    const r = validateAudioFile(baseFile('note.txt', 10, Buffer.from('a')));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  test.each([
    ['doc.pdf', 100, Buffer.from('%PDF-1.4\n'), true],
    ['x.pdf', 10, Buffer.from('bad'), false],
  ])('validateDiagnosisPdfBuffer %s', (name, size, buf, expectOk) => {
    const f = { ...baseFile(name, size, buf), mimetype: 'application/pdf' };
    const r = validateDiagnosisPdfBuffer(f);
    expect(r.ok).toBe(expectOk);
  });

  test.each([
    [50, 100, true],
    [200, 100, false],
  ])('validateFileSizeBytes fileSize=%i max=%i', (fileSize, max, ok) => {
    const r = validateFileSizeBytes({ size: fileSize }, max);
    expect(r.ok).toBe(ok);
  });

  it('exposes expected audio set', () => {
    expect(AUDIO_EXT.size).toBe(6);
  });
});
