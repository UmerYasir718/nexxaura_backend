class AsyncTimeoutError extends Error {
  /**
   * @param {string} [label]
   * @param {number} [ms]
   */
  constructor(message = 'Operation timed out', label, ms) {
    super(message);
    this.name = 'AsyncTimeoutError';
    this.code = 'ETIMEDOUT';
    this.label = label;
    this.timeoutMs = ms;
  }
}

module.exports = AsyncTimeoutError;
