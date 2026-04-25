import fs from 'fs';
import path from 'path';

export function createLogger(options = {}) {
  const logFile = options.logFile || null;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  }

  function write(line) {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    // eslint-disable-next-line no-console
    console.log(stamped);
    if (logFile) {
      fs.appendFileSync(logFile, `${stamped}\n`, 'utf8');
    }
  }

  return {
    info: (msg) => write(`INFO  ${msg}`),
    warn: (msg) => write(`WARN  ${msg}`),
    error: (msg, err) => {
      const extra = err?.stack ? ` ${err.stack}` : err ? ` ${String(err)}` : '';
      write(`ERROR ${msg}${extra}`);
    },
    step: (name, detail = '') => write(`STEP  ${name}${detail ? ` — ${detail}` : ''}`),
  };
}
