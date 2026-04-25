const { AsyncLocalStorage } = require('node:async_hooks');

const requestStore = new AsyncLocalStorage();

/**
 * @typedef {{ queryCount: number, startedAt: number }} RequestContext
 */

function getStore() {
  return requestStore.getStore();
}

function runWithRequestContext(fn) {
  return requestStore.run({ queryCount: 0, startedAt: Date.now() }, fn);
}

function incrementDbQuery() {
  const s = getStore();
  if (s) s.queryCount += 1;
}

function getRequestDbQueryCount() {
  const s = getStore();
  return s ? s.queryCount : 0;
}

module.exports = {
  getStore,
  runWithRequestContext,
  incrementDbQuery,
  getRequestDbQueryCount,
};
