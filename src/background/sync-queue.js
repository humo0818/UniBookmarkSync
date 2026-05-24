/**
 * Promise-based serial queue with retry and exponential backoff.
 *
 * Ensures only one sync operation runs at a time, preventing concurrent
 * pushes from corrupting remote state.
 */
import * as logger from '../lib/logger.js';
import { MAX_RETRIES, RETRY_BACKOFF_BASE_MS } from '../shared/constants.js';

const LOG_TAG = 'sync-queue';

export class SyncQueue {
  constructor() {
    this._running = false;
    this._queue = [];
  }

  /** Queue a function. Returns a Promise that resolves/rejects with the result. */
  enqueue(fn, options = {}) {
    const maxRetries = options.maxRetries ?? MAX_RETRIES;
    const backoffMs = options.backoffMs ?? RETRY_BACKOFF_BASE_MS;
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, maxRetries, backoffMs, resolve, reject });
      this._processNext();
    });
  }

  async _processNext() {
    if (this._running || this._queue.length === 0) return;
    this._running = true;

    const job = this._queue.shift();
    for (let attempt = 1; attempt <= job.maxRetries + 1; attempt++) {
      try {
        const result = await job.fn();
        job.resolve(result);
        break;
      } catch (err) {
        if (attempt > job.maxRetries) {
          logger.error(LOG_TAG, `Failed after ${attempt} attempts`);
          job.reject(err);
          break;
        }
        const delay = job.backoffMs * Math.pow(2, attempt - 1);
        logger.warn(LOG_TAG, `Attempt ${attempt} failed, retry in ${delay}ms: ${err.message}`);
        await sleep(delay);
      }
    }

    this._running = false;
    this._processNext();
  }

  get length() { return this._queue.length; }
  get isRunning() { return this._running; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default SyncQueue;
