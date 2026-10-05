/**
 * Quota ledger: provider summary cards over a compact per-credential table of
 * remaining allowance, for Claude and Codex credentials.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type {
  AuthFileItem,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  CodexQuotaState,
  CodexQuotaWindow,
} from '@/types';
import { formatDateTimeValue, formatRelativeTimeLabel } from '@/utils/format';
import {
  codexQuotaPersistInputFromData,
  getStatusFromError,
  persistCodexQuotaSnapshot,
} from '@/utils/quota';
import iconClaude from '@/assets/icons/claude.svg';
import iconCodex from '@/assets/icons/codex.svg';
import { CLAUDE_CONFIG, CODEX_CONFIG, codexPlanLabel } from './quotaConfigs';
import type { QuotaConfig } from './quotaConfigs';
import { useQuotaLoader } from './useQuotaLoader';
import {
  formatResetClock,
  maskCredentialName,
  remainingFromUsed,
  remainingTone,
  totalWindows,
} from './quotaLedgerModel';
import type { LedgerTone, LedgerWindow, LedgerWindowTotal } from './quotaLedgerModel';
import styles from './QuotaLedger.module.scss';

type ProviderId = 'claude' | 'codex';
type TabId = 'all' | ProviderId;
type LedgerState = ClaudeQuotaState | CodexQuotaState;

const SHOW_EMAILS_KEY = 'cli-proxy-quota-show-emails';

interface ProviderMeta {
  id: ProviderId;
  labelKey: string;
  icon: string;
}

const PROVIDERS: ProviderMeta[] = [
  { id: 'claude', labelKey: 'quota_ledger.provider_claude', icon: iconClaude },
  { id: 'codex', labelKey: 'quota_ledger.provider_codex', icon: iconCodex },
];

interface LedgerRow {
  file: AuthFileItem;
  state: LedgerState | undefined;
  windows: LedgerWindow[];
  planLabel: string | null;
}

interface ProviderData {
  meta: ProviderMeta;
  rows: LedgerRow[];
  totals: LedgerWindowTotal[];
  refreshOne: (file: AuthFileItem) => void;
  loadMany: (files: AuthFileItem[]) => void;
  busy: boolean;
}

function readShowEmails(): boolean {
  try {
    return localStorage.getItem(SHOW_EMAILS_KEY) === 'true';
  } catch {
    return false;
  }
}

function windowLabel(t: TFunction, window: ClaudeQuotaWindow | CodexQuotaWindow): string {
  if (!window.labelKey) return window.label;
  const params = 'labelParams' in window ? window.labelParams : undefined;
  return String(t(window.labelKey, params));
}

function toLedgerWindows(t: TFunction, state: LedgerState | undefined): LedgerWindow[] {
  if (!state || state.status !== 'success') return [];
  return state.windows.map((window) => ({
    id: window.id,
    label: windowLabel(t, window),
    remaining: remainingFromUsed(window.usedPercent),
    resetAt: window.resetAt ?? null,
  }));
}

function planLabelFor(
  t: TFunction,
  provider: ProviderId,
  file: AuthFileItem,
  state: LedgerState | undefined
): string | null {
  if (provider === 'claude') {
    const planType = (state as ClaudeQuotaState | undefined)?.planType;
    return planType ? String(t(`claude_quota.${planType}`)) : null;
  }
  const planType =
    (state as CodexQuotaState | undefined)?.planType ??
    (typeof file.plan_type === 'string' ? file.plan_type : null);
  return codexPlanLabel(t, planType);
}

function useLedgerProvider(
  meta: ProviderMeta,
  config: QuotaConfig<LedgerState, unknown>,
  files: AuthFileItem[],
  filesLoading: boolean,
  disabled: boolean
): ProviderData {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as (
    updater: (prev: Record<string, LedgerState>) => Record<string, LedgerState>
  ) => void;
  const { quota, loadQuota } = useQuotaLoader(config);
  const [busy, setBusy] = useState(false);

  const credentialFiles = useMemo(() => files.filter(config.filterFn), [files, config]);

  const loadMany = useCallback(
    (targets: AuthFileItem[]) => {
      if (disabled || targets.length === 0) return;
      void loadQuota(targets, setBusy);
    },
    [disabled, loadQuota]
  );

  // Load quota once for credentials that have nothing cached yet.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current || filesLoading || disabled) return;
    if (credentialFiles.length === 0) return;
    autoLoadedRef.current = true;
    const missing = credentialFiles.filter((file) => !quota[file.name]);
    if (missing.length > 0) loadMany(missing);
  }, [credentialFiles, disabled, filesLoading, loadMany, quota]);

  const refreshOne = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || quota[file.name]?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      setQuota((prev) => ({ ...prev, [file.name]: config.buildLoadingState() }));
      try {
        const data = await config.fetchQuota(file, t);
        if (config.type === 'codex') {
          try {
            await persistCodexQuotaSnapshot(
              file.name,
              codexQuotaPersistInputFromData(data as Parameters<typeof codexQuotaPersistInputFromData>[0])
            );
          } catch {
            // Showing the quota still succeeds if saving the snapshot fails.
          }
        }
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({ ...prev, [file.name]: config.buildSuccessState(data) }));
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({ ...prev, [file.name]: config.buildErrorState(message, status) }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: file.name, message }),
            'error'
          );
        });
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const rows = useMemo<LedgerRow[]>(
    () =>
      credentialFiles.map((file) => {
        const state = quota[file.name];
        return {
          file,
          state,
          windows: toLedgerWindows(t, state),
          planLabel: planLabelFor(t, meta.id, file, state),
        };
      }),
    [credentialFiles, meta.id, quota, t]
  );

  const totals = useMemo(() => totalWindows(rows.map((row) => row.windows)), [rows]);

  return {
    meta,
    rows,
    totals,
    refreshOne: (file) => void refreshOne(file),
    loadMany,
    busy,
  };
}

function toneClass(tone: LedgerTone): string {
  return styles[`tone_${tone}`] ?? '';
}

function ResetText({ resetAt, emptyLabel }: { resetAt: number | null; emptyLabel: string }) {
  const { t, i18n } = useTranslation();
  if (resetAt === null) return <span className={styles.resetMuted}>{emptyLabel}</span>;
  const relative = formatRelativeTimeLabel(t, resetAt);
  return (
    <span className={styles.reset} title={formatDateTimeValue(resetAt) || undefined}>
      <strong>{relative}</strong>
      <span className={styles.resetDot}>·</span>
      {formatResetClock(resetAt, i18n.language)}
    </span>
  );
}

function Meter({ remaining }: { remaining: number | null }) {
  const width = remaining === null ? 0 : Math.max(0, Math.min(100, remaining));
  return (
    <div className={styles.meter}>
      <div
        className={`${styles.meterFill} ${toneClass(remainingTone(remaining))}`}
        style={{ width: `${width}%` } as CSSProperties}
      />
    </div>
  );
}

function SegmentMeter({ segments }: { segments: Array<number | null> }) {
  return (
    <div className={styles.segments}>
      {segments.map((value, index) => (
        <div key={index} className={styles.segment}>
          <div
            className={`${styles.segmentFill} ${toneClass(remainingTone(value))}`}
            style={{ width: `${value === null ? 0 : value}%` } as CSSProperties}
          />
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ provider }: { provider: ProviderData }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [primary, ...others] = provider.totals;
  const count = provider.rows.length;

  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryHead}>
        <span className={styles.providerName}>
          <img src={provider.meta.icon} alt="" className={styles.providerIcon} />
          {t(provider.meta.labelKey)}
        </span>
        <span className={styles.summaryCount}>
          {t('quota_ledger.credential_count', { count })}
        </span>
      </div>
      {primary ? (
        <>
          <div className={styles.summaryLabel}>{primary.label}</div>
          <div className={styles.summaryFigure}>
            <span className={styles.summaryValue}>
              {primary.max > 0 ? `${Math.round(primary.total)}%` : '--'}
            </span>
            <span className={styles.summaryOf}>
              {t('quota_ledger.of_total', { max: Math.max(primary.max, count * 100) })}
            </span>
          </div>
          <SegmentMeter segments={primary.segments} />
          <div className={styles.summaryReset}>
            <ResetText resetAt={primary.earliestReset} emptyLabel={t('quota_ledger.no_reset')} />
          </div>
          {others.length > 0 && (
            <div className={styles.summaryMore}>
              {(expanded ? others : others.slice(0, 1)).map((entry) => (
                <div key={entry.id} className={styles.summaryMoreRow}>
                  <span className={styles.summaryMoreLabel}>{entry.label}</span>
                  <span className={styles.summaryMoreValue}>
                    {entry.max > 0 ? `${Math.round(entry.total)}%` : '--'}
                  </span>
                </div>
              ))}
              {others.length > 1 && (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t('quota_ledger.show_less') : t('quota_ledger.show_more')}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className={styles.summaryEmpty}>
          {provider.busy ? t('quota_ledger.loading') : t('quota_ledger.no_data')}
        </div>
      )}
    </div>
  );
}

function CredentialRow({
  row,
  showEmails,
  onRefresh,
  disabled,
}: {
  row: LedgerRow;
  showEmails: boolean;
  onRefresh: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const status = row.state?.status ?? 'idle';
  const name = showEmails ? row.file.name : maskCredentialName(row.file.name);

  let body;
  if (status === 'loading') {
    body = <div className={styles.rowMessage}>{t('quota_ledger.loading')}</div>;
  } else if (status === 'error') {
    body = (
      <div className={`${styles.rowMessage} ${styles.rowError}`}>
        {row.state?.error || t('common.unknown_error')}
      </div>
    );
  } else if (status !== 'success') {
    body = <div className={styles.rowMessage}>{t('quota_ledger.not_loaded')}</div>;
  } else if (row.windows.length === 0) {
    body = <div className={styles.rowMessage}>{t('quota_ledger.no_windows')}</div>;
  } else {
    body = (
      <div className={styles.windows}>
        {row.windows.map((window) => (
          <div key={window.id} className={styles.window}>
            <div className={styles.windowHead}>
              <span className={styles.windowLabel}>{window.label}</span>
              <span className={styles.windowValue}>
                {window.remaining === null ? '--' : `${Math.round(window.remaining)}%`}
              </span>
            </div>
            <Meter remaining={window.remaining} />
            <ResetText resetAt={window.resetAt} emptyLabel={t('quota_ledger.no_reset')} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.credentialName} title={showEmails ? undefined : name}>
          {name}
        </span>
        {row.planLabel && <span className={styles.plan}>{row.planLabel}</span>}
      </div>
      {body}
      <button
        type="button"
        className={styles.rowAction}
        onClick={onRefresh}
        disabled={disabled || status === 'loading'}
      >
        <IconRefreshCw size={13} />
        {t('quota_ledger.refresh_quota')}
      </button>
    </div>
  );
}

interface QuotaLedgerProps {
  files: AuthFileItem[];
  filesLoading: boolean;
  disabled: boolean;
  layoutControl: React.ReactNode;
}

export function QuotaLedger({ files, filesLoading, disabled, layoutControl }: QuotaLedgerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('all');
  const [showEmails, setShowEmails] = useState(readShowEmails);

  const claude = useLedgerProvider(
    PROVIDERS[0],
    CLAUDE_CONFIG as unknown as QuotaConfig<LedgerState, unknown>,
    files,
    filesLoading,
    disabled
  );
  const codex = useLedgerProvider(
    PROVIDERS[1],
    CODEX_CONFIG as unknown as QuotaConfig<LedgerState, unknown>,
    files,
    filesLoading,
    disabled
  );
  const providers = [claude, codex];
  const visible = providers.filter(
    (provider) => (tab === 'all' || provider.meta.id === tab) && provider.rows.length > 0
  );

  const total = claude.rows.length + codex.rows.length;
  const loaded = [...claude.rows, ...codex.rows].filter(
    (row) => row.state?.status === 'success'
  ).length;
  const busy = claude.busy || codex.busy;

  const toggleEmails = () => {
    setShowEmails((value) => {
      const next = !value;
      try {
        localStorage.setItem(SHOW_EMAILS_KEY, String(next));
      } catch {
        // Remembering the choice is a convenience only.
      }
      return next;
    });
  };

  const refreshAll = () => {
    providers.forEach((provider) => provider.loadMany(provider.rows.map((row) => row.file)));
  };

  const tabs: Array<{ id: TabId; label: string; count: number; icon?: string }> = [
    { id: 'all', label: t('quota_ledger.tab_all'), count: total },
    ...providers.map((provider) => ({
      id: provider.meta.id,
      label: t(provider.meta.labelKey),
      count: provider.rows.length,
      icon: provider.meta.icon,
    })),
  ];

  return (
    <div className={styles.ledger}>
      <header className={styles.header}>
        <div>
          <h1>{t('quota_management.title')}</h1>
          <div className={styles.headerMeta}>
            {t('quota_ledger.credential_count', { count: total })}
            <span className={styles.resetDot}>·</span>
            <span className={styles.loaded}>{t('quota_ledger.loaded_count', { count: loaded })}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" size="sm" onClick={toggleEmails}>
            {showEmails ? t('quota_ledger.hide_emails') : t('quota_ledger.show_emails')}
          </Button>
          <Button size="sm" onClick={refreshAll} disabled={disabled || total === 0} loading={busy}>
            {!busy && <IconRefreshCw size={14} />}
            {t('quota_ledger.refresh_all')}
          </Button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.icon && <img src={item.icon} alt="" className={styles.providerIcon} />}
              {item.label}
              <span className={styles.tabCount}>{item.count}</span>
            </button>
          ))}
        </div>
        {layoutControl}
      </div>

      {total === 0 && !filesLoading ? (
        <div className={styles.empty}>{t('quota_ledger.empty')}</div>
      ) : (
        <>
          {visible.length > 0 && (
            <div className={styles.summaryGrid}>
              {visible.map((provider) => (
                <SummaryCard key={provider.meta.id} provider={provider} />
              ))}
            </div>
          )}
          {visible.map((provider) => (
            <section key={provider.meta.id} className={styles.group}>
              <h2 className={styles.groupTitle}>
                {t(provider.meta.labelKey)}
                <span className={styles.groupCount}>{provider.rows.length}</span>
              </h2>
              <div className={styles.rows}>
                {provider.rows.map((row) => (
                  <CredentialRow
                    key={row.file.name}
                    row={row}
                    showEmails={showEmails}
                    disabled={disabled}
                    onRefresh={() => provider.refreshOne(row.file)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
