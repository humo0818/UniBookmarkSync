import { t } from '../../lib/i18n.js';
import browser from '../../lib/browser-polyfill.js';

const iconUrl = browser.runtime.getURL('icons/UniBookmarkSync-icon.svg');

/** Config-driven status → color mapping */
const STATUS_CONFIG = {
  idle:     { filterClass: 'icon-filter--green',  label: 'statusIdle' },
  syncing:  { filterClass: 'icon-filter--blue',   label: 'statusSyncing', animate: true },
  error:    { filterClass: 'icon-filter--red',    label: 'statusError' },
  conflict: { filterClass: 'icon-filter--orange', label: 'statusConflict' },
};

export default function StatusIndicator({ status, lastSync, bookmarkCount, errorMessage, adapter, configured }) {
  const hasNeverSynced = !lastSync;
  const effectiveStatus = (hasNeverSynced && status === 'idle') ? 'idle' : status;
  const cfg = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.idle;
  const isConfigured = configured !== false; // default true

  // Gray icon for not-configured or never-synced, color otherwise
  const filterClass = (!isConfigured || (hasNeverSynced && effectiveStatus === 'idle'))
    ? 'icon-filter--gray'
    : cfg.filterClass;

  const adapterLabel = adapter ? `${adapter} ` : '';
  let label;
  if (!isConfigured) label = adapterLabel + t('statusNotConfigured');
  else if (hasNeverSynced && effectiveStatus === 'idle') label = adapterLabel + t('statusNever');
  else label = adapterLabel + t(cfg.label);

  return (
    <div class="status-indicator">
      <div class={`status-icon-wrap ${cfg.animate ? 'status-icon--pulse' : ''}`}>
        <img src={iconUrl} class={`status-svg-icon ${filterClass}`} alt="" />
      </div>
      <span class="status-label">{label}</span>
      {lastSync && (
        <div class="status-meta">
          <span>{t('lastSync')}: {formatRelativeTime(lastSync)}</span>
          {bookmarkCount != null && (
            <span> &middot; {bookmarkCount} {t('bookmarkCount')}</span>
          )}
        </div>
      )}
      {errorMessage && <div class="status-error">{errorMessage}</div>}
    </div>
  );
}

function formatRelativeTime(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t('secondsAgo');
  return t('minutesAgo', String(minutes));
}
