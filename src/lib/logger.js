/**
 * Namespaced logger with level filtering.
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = 'info';

export function setLevel(level) {
  if (level in LEVELS) currentLevel = level;
}

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[currentLevel];
}

export function debug(tag, msg, data) {
  if (shouldLog('debug')) console.debug(`[${tag}] ${msg}`, data ?? '');
}

export function info(tag, msg, data) {
  if (shouldLog('info')) console.info(`[${tag}] ${msg}`, data ?? '');
}

export function warn(tag, msg, data) {
  if (shouldLog('warn')) console.warn(`[${tag}] ${msg}`, data ?? '');
}

export function error(tag, msg, data) {
  if (shouldLog('error')) console.error(`[${tag}] ${msg}`, data ?? '');
}

export default { debug, info, warn, error, setLevel };
