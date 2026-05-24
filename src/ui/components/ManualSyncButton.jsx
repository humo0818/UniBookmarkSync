import { useState, useEffect, useRef } from 'preact/hooks';
import { t } from '../../lib/i18n.js';

const SYNC_TIMEOUT_MS = 15000;

/**
 * Sync Now button with timeout fallback.
 * Shows spinner while syncing, error hint on failure/timeout.
 */
export default function ManualSyncButton({ onSync, syncing, lastError }) {
  const [localError, setLocalError] = useState(null);
  const timerRef = useRef(null);

  // Start timeout countdown when syncing begins
  useEffect(() => {
    if (syncing) {
      setLocalError(null);
      timerRef.current = setTimeout(() => setLocalError(t('statusError')), SYNC_TIMEOUT_MS);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [syncing]);

  // Propagate parent errors
  useEffect(() => { if (lastError) setLocalError(lastError); }, [lastError]);

  return (
    <div class="sync-button-area">
      <button class="btn-primary sync-button" onClick={onSync} disabled={syncing}>
        {syncing && <span class="sync-spinner" />}
        {syncing ? t('statusSyncing') : t('syncNow')}
      </button>
      {localError && !syncing && <p class="sync-error-hint">{localError}</p>}
    </div>
  );
}
