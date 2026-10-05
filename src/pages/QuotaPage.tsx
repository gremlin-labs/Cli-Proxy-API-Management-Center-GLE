/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { Select } from '@/components/ui/Select';
import { QuotaLedger } from '@/components/quota/QuotaLedger';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  META_CONFIG,
  QODERCN_CONFIG,
  QODER_CONFIG,
  XAI_CONFIG,
  DEVIN_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

type QuotaLayout = 'ledger' | 'cards';
const LAYOUT_KEY = 'cli-proxy-quota-layout';

function readLayout(): QuotaLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'cards' ? 'cards' : 'ledger';
  } catch {
    return 'ledger';
  }
}

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';
  const [layout, setLayoutState] = useState<QuotaLayout>(readLayout);

  const setLayout = (value: string) => {
    const next: QuotaLayout = value === 'cards' ? 'cards' : 'ledger';
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Remembering the layout is a convenience only.
    }
  };

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const layoutControl = (
    <Select
      value={layout}
      onChange={setLayout}
      size="sm"
      fullWidth={false}
      className={styles.layoutSelect}
      ariaLabel={t('quota_ledger.layout_label')}
      options={[
        { value: 'ledger', label: t('quota_ledger.layout_ledger') },
        { value: 'cards', label: t('quota_ledger.layout_cards') },
      ]}
    />
  );

  if (layout === 'ledger') {
    return (
      <div className={styles.container}>
        {error && <div className={styles.errorBox}>{error}</div>}
        <QuotaLedger
          files={files}
          filesLoading={loading}
          disabled={disableControls}
          layoutControl={layoutControl}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.layoutBar}>{layoutControl}</div>
      {error && <div className={styles.errorBox}>{error}</div>}

      {files.some(CLAUDE_CONFIG.filterFn) && (
        <QuotaSection
          config={CLAUDE_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(ANTIGRAVITY_CONFIG.filterFn) && (
        <QuotaSection
          config={ANTIGRAVITY_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(CODEX_CONFIG.filterFn) && (
        <QuotaSection
          config={CODEX_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(XAI_CONFIG.filterFn) && (
        <QuotaSection
          config={XAI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(DEVIN_CONFIG.filterFn) && (
        <QuotaSection
          config={DEVIN_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(KIMI_CONFIG.filterFn) && (
        <QuotaSection
          config={KIMI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(META_CONFIG.filterFn) && (
        <QuotaSection
          config={META_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(QODERCN_CONFIG.filterFn) && (
        <QuotaSection
          config={QODERCN_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
      {files.some(QODER_CONFIG.filterFn) && (
        <QuotaSection
          config={QODER_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      )}
    </div>
  );
}
