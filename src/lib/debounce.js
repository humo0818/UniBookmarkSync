/**
 * Debounce utility — delays function execution until after `delay` ms
 * of inactivity. Supports cancel() and flush().
 */
export default function debounce(fn, delay) {
  let timer = null;

  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn();
    }
  };

  return debounced;
}
