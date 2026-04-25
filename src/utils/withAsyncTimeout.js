const AsyncTimeoutError = require('./AsyncTimeoutError');

/**
 * Races a promise with a timeout, optionally aborting.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {{ label?: string, signal?: AbortSignal, onTimeout?: () => void }} [opts]
 * @returns {Promise<T>}
 */
function withAsyncTimeout(promise, ms, opts = {}) {
  if (ms <= 0) return Promise.resolve(promise);
  const { label, signal, onTimeout } = opts;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout && onTimeout();
      reject(new AsyncTimeoutError('Operation timed out', label, ms));
    }, ms);
    t.unref && t.unref();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t);
        reject(new AsyncTimeoutError('Aborted', label, ms));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          try {
            onTimeout && onTimeout();
          } finally {
            const err = signal.reason;
            if (err instanceof Error) reject(err);
            else reject(new Error(String(err || 'Aborted')));
          }
        },
        { once: true },
      );
    }
    Promise.resolve(promise)
      .then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
  });
}

module.exports = { withAsyncTimeout };
