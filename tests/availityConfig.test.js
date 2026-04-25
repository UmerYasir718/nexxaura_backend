const path = require('path');

describe('availity config', () => {
  const originalStorage = process.env.AVAILITY_STORAGE_STATE;

  afterEach(() => {
    if (originalStorage == null) {
      delete process.env.AVAILITY_STORAGE_STATE;
    } else {
      process.env.AVAILITY_STORAGE_STATE = originalStorage;
    }
    jest.resetModules();
  });

  it('defaults storage state to the working availity session file', () => {
    delete process.env.AVAILITY_STORAGE_STATE;
    const { buildAvailityConfig } = require('../src/config/availityConfigForUser');

    const config = buildAvailityConfig({
      avUsername: 'user',
      avPassword: 'pass',
    });

    expect(config.availity.storageStatePath).toBe(path.resolve(process.cwd(), 'availity', 'availity-auth.json'));
  });

  it('can disable storage state from env', () => {
    process.env.AVAILITY_STORAGE_STATE = '0';
    const { buildAvailityConfig } = require('../src/config/availityConfigForUser');

    const config = buildAvailityConfig({
      avUsername: 'user',
      avPassword: 'pass',
    });

    expect(config.availity.storageStatePath).toBe('');
  });
});
