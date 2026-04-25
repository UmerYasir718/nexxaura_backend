const { stripIntegrationRaw } = require('../src/utils/sanitizeDataResponse');

describe('stripIntegrationRaw', () => {
  it('removes raw_payload and raw_snapshot at any depth', () => {
    const input = {
      a: 1,
      raw_payload: { x: 1 },
      nest: { raw_snapshot: { y: 2 }, z: 3 },
    };
    const out = stripIntegrationRaw(input);
    expect(out).toEqual({ a: 1, nest: { z: 3 } });
  });

  it('strips in arrays', () => {
    const out = stripIntegrationRaw([{ id: 1, raw_payload: {} }]);
    expect(out).toEqual([{ id: 1 }]);
  });
});
