import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type {
  CodexFailureConfig,
  CodexInstructionsConfig,
  CodexInstructionsMode,
  CodexRoutingConfig,
} from '@/types';
import styles from './CodexInstructionsPage.module.scss';

const LazyMarkdownSourceEditor = lazy(() => import('@/components/config/MarkdownSourceEditor'));

type CodexConfigTab = 'error_handling' | 'routing' | 'instructions';

const DEFAULT_INSTRUCTIONS: CodexInstructionsConfig = {
  enabled: false,
  mode: 'prepend',
  content: '',
  file: '',
  models: ['gpt-5.5', 'gpt-5*'],
  oauthOnly: true,
};

const DEFAULT_FAILURE: CodexFailureConfig = {
  autoDisableAuthFailures: true,
  authFailureDisableAfter: 1,
  usageLimitDisableAfter: 3,
  usageLimitCooldownFallbackHours: 1,
};

const DEFAULT_ROUTING: CodexRoutingConfig = {
  strategy: '',
  preferFreeForSharedModels: false,
};

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeInstructions(config: CodexInstructionsConfig): CodexInstructionsConfig {
  return {
    ...config,
    mode: config.mode || 'prepend',
    content: config.content ?? '',
    file: config.file ?? '',
    models: config.models.map((model) => model.trim()).filter(Boolean),
    oauthOnly: config.oauthOnly !== false,
  };
}

function normalizeFailure(config: CodexFailureConfig): CodexFailureConfig {
  return {
    autoDisableAuthFailures: config.autoDisableAuthFailures !== false,
    authFailureDisableAfter: Math.max(0, Math.floor(config.authFailureDisableAfter || 0)),
    usageLimitDisableAfter: Math.max(0, Math.floor(config.usageLimitDisableAfter || 0)),
    usageLimitCooldownFallbackHours: Math.max(
      0,
      Math.floor(config.usageLimitCooldownFallbackHours || 0)
    ),
  };
}

function sameInstructions(a: CodexInstructionsConfig, b: CodexInstructionsConfig): boolean {
  return JSON.stringify(normalizeInstructions(a)) === JSON.stringify(normalizeInstructions(b));
}

function sameFailure(a: CodexFailureConfig, b: CodexFailureConfig): boolean {
  return JSON.stringify(normalizeFailure(a)) === JSON.stringify(normalizeFailure(b));
}

export function CodexInstructionsPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);

  const [activeTab, setActiveTab] = useState<CodexConfigTab>('error_handling');

  // --- Error handling state ---
  const [failureDraft, setFailureDraft] = useState<CodexFailureConfig>(DEFAULT_FAILURE);
  const [failureSaved, setFailureSaved] = useState<CodexFailureConfig>(DEFAULT_FAILURE);
  const [failureLoading, setFailureLoading] = useState(true);
  const [failureSaving, setFailureSaving] = useState(false);
  const [failureError, setFailureError] = useState('');

  // --- Account routing state ---
  const [routingDraft, setRoutingDraft] = useState<CodexRoutingConfig>(DEFAULT_ROUTING);
  const [routingSaved, setRoutingSaved] = useState<CodexRoutingConfig>(DEFAULT_ROUTING);
  const [routingLoading, setRoutingLoading] = useState(true);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingError, setRoutingError] = useState('');

  // --- Instructions state ---
  const [instrDraft, setInstrDraft] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [instrSaved, setInstrSaved] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [modelsInput, setModelsInput] = useState(DEFAULT_INSTRUCTIONS.models.join('\n'));
  const [instrLoading, setInstrLoading] = useState(true);
  const [instrSaving, setInstrSaving] = useState(false);
  const [instrError, setInstrError] = useState('');

  const failureDisabled = connectionStatus !== 'connected' || failureLoading || failureSaving;
  const failureDirty = !sameFailure(failureDraft, failureSaved);
  const failureStatusClass = failureError
    ? styles.error
    : failureDirty
      ? styles.modified
      : styles.saved;
  const failureStatusText = failureError
    ? t('codex_config.failure.status_load_failed')
    : failureLoading
      ? t('codex_config.failure.status_loading')
      : failureSaving
        ? t('codex_config.failure.status_saving')
        : failureDirty
          ? t('codex_config.failure.status_dirty')
          : t('codex_config.failure.status_loaded');

  const routingDisabled = connectionStatus !== 'connected' || routingLoading || routingSaving;
  const routingDirty =
    routingDraft.strategy !== routingSaved.strategy ||
    routingDraft.preferFreeForSharedModels !== routingSaved.preferFreeForSharedModels;
  const routingStatusClass = routingError
    ? styles.error
    : routingDirty
      ? styles.modified
      : styles.saved;
  const routingStatusText = routingError
    ? t('codex_config.routing.status_load_failed')
    : routingLoading
      ? t('codex_config.routing.status_loading')
      : routingSaving
        ? t('codex_config.routing.status_saving')
        : routingDirty
          ? t('codex_config.routing.status_dirty')
          : t('codex_config.routing.status_loaded');

  const effectiveInstrDraft = useMemo(
    () => ({
      ...instrDraft,
      models: parseModels(modelsInput),
    }),
    [instrDraft, modelsInput]
  );
  const instrDisabled = connectionStatus !== 'connected' || instrLoading || instrSaving;
  const instrDirty = !sameInstructions(effectiveInstrDraft, instrSaved);
  const modelChips =
    effectiveInstrDraft.models.length > 0
      ? effectiveInstrDraft.models
      : DEFAULT_INSTRUCTIONS.models;
  const instrStatusClass = instrError ? styles.error : instrDirty ? styles.modified : styles.saved;
  const instrStatusText = instrError
    ? t('codex_instructions.status_load_failed')
    : instrLoading
      ? t('codex_instructions.status_loading')
      : instrSaving
        ? t('codex_instructions.status_saving')
        : instrDirty
          ? t('codex_instructions.status_dirty')
          : t('codex_instructions.status_loaded');

  const modeOptions = useMemo(
    () => [
      { value: 'prepend', label: t('codex_instructions.mode_prepend') },
      { value: 'append', label: t('codex_instructions.mode_append') },
      { value: 'replace', label: t('codex_instructions.mode_replace') },
    ],
    [t]
  );

  const activeDirty =
    activeTab === 'error_handling'
      ? failureDirty
      : activeTab === 'routing'
        ? routingDirty
        : instrDirty;
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    shouldBlock: failureDirty || routingDirty || instrDirty,
    dialog: unsavedChangesDialog,
  });

  const loadFailure = useCallback(async () => {
    setFailureLoading(true);
    setFailureError('');
    try {
      const next = normalizeFailure(await configApi.getCodexFailureConfig());
      setFailureDraft(next);
      setFailureSaved(next);
    } catch (err: unknown) {
      setFailureError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setFailureLoading(false);
    }
  }, [t]);

  const applyLoadedInstructions = useCallback((config: CodexInstructionsConfig) => {
    const nextConfig = normalizeInstructions(config);
    setInstrDraft(nextConfig);
    setInstrSaved(nextConfig);
    setModelsInput(nextConfig.models.join('\n'));
  }, []);

  const loadRouting = useCallback(async () => {
    setRoutingLoading(true);
    setRoutingError('');
    try {
      const next = await configApi.getCodexRoutingConfig();
      setRoutingDraft(next);
      setRoutingSaved(next);
    } catch (err: unknown) {
      setRoutingError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setRoutingLoading(false);
    }
  }, [t]);

  const loadInstructions = useCallback(async () => {
    setInstrLoading(true);
    setInstrError('');
    try {
      const config = await configApi.getCodexInstructions();
      applyLoadedInstructions(config);
    } catch (err: unknown) {
      setInstrError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setInstrLoading(false);
    }
  }, [applyLoadedInstructions, t]);

  useEffect(() => {
    void loadFailure();
    void loadRouting();
    void loadInstructions();
  }, [loadFailure, loadInstructions, loadRouting]);

  const updateFailure = useCallback((patch: Partial<CodexFailureConfig>) => {
    setFailureDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateInstrDraft = useCallback((patch: Partial<CodexInstructionsConfig>) => {
    setInstrDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateFailureNumber = (
    key: 'authFailureDisableAfter' | 'usageLimitDisableAfter' | 'usageLimitCooldownFallbackHours',
    value: string
  ) => {
    const parsed = Number.parseInt(value, 10);
    updateFailure({ [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
  };

  const handleTabChange = useCallback(
    (next: CodexConfigTab) => {
      if (next === activeTab) return;
      if (activeDirty) {
        showConfirmation({
          title: t('common.unsaved_changes_title'),
          message: t('codex_config.tab_switch_dirty_message'),
          confirmText: t('common.confirm'),
          cancelText: t('common.cancel'),
          variant: 'danger',
          onConfirm: async () => {
            setActiveTab(next);
          },
        });
        return;
      }
      setActiveTab(next);
    },
    [activeDirty, activeTab, showConfirmation, t]
  );

  const handleFailureReload = useCallback(() => {
    if (!failureDirty) {
      void loadFailure();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('codex_config.failure.reload_confirm_message'),
      confirmText: t('codex_config.failure.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadFailure();
      },
    });
  }, [failureDirty, loadFailure, showConfirmation, t]);

  const handleFailureSave = useCallback(async () => {
    const next = normalizeFailure(failureDraft);
    setFailureSaving(true);
    try {
      await configApi.updateCodexFailureConfig(next);
      setFailureDraft(next);
      setFailureSaved(next);
      showNotification(t('codex_config.failure.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setFailureSaving(false);
    }
  }, [failureDraft, showNotification, t]);

  const handleRoutingReload = useCallback(() => {
    if (!routingDirty) {
      void loadRouting();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('codex_config.routing.reload_confirm_message'),
      confirmText: t('codex_config.routing.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadRouting();
      },
    });
  }, [loadRouting, routingDirty, showConfirmation, t]);

  const handleRoutingSave = useCallback(async () => {
    setRoutingSaving(true);
    try {
      await configApi.updateCodexRoutingConfig(routingDraft);
      setRoutingSaved(routingDraft);
      showNotification(t('codex_config.routing.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setRoutingSaving(false);
    }
  }, [routingDraft, showNotification, t]);

  const handleInstrReload = useCallback(() => {
    if (!instrDirty) {
      void loadInstructions();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('codex_instructions.reload_confirm_message'),
      confirmText: t('codex_instructions.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadInstructions();
      },
    });
  }, [instrDirty, loadInstructions, showConfirmation, t]);

  const handleInstrSave = useCallback(async () => {
    const nextConfig = normalizeInstructions(effectiveInstrDraft);
    if (nextConfig.models.length === 0) {
      showNotification(t('codex_instructions.models_required'), 'error');
      return;
    }

    setInstrSaving(true);
    try {
      await configApi.updateCodexInstructions(nextConfig);
      applyLoadedInstructions(nextConfig);
      showNotification(t('codex_instructions.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setInstrSaving(false);
    }
  }, [applyLoadedInstructions, effectiveInstrDraft, showNotification, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.tabBar} role="tablist" aria-label={t('codex_config.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'error_handling'}
            className={`${styles.tabItem} ${activeTab === 'error_handling' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('error_handling')}
          >
            {t('codex_config.tabs.error_handling')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'routing'}
            className={`${styles.tabItem} ${activeTab === 'routing' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('routing')}
          >
            {t('codex_config.tabs.routing')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'instructions'}
            className={`${styles.tabItem} ${activeTab === 'instructions' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('instructions')}
          >
            {t('codex_config.tabs.instructions')}
          </button>
        </div>
        <div className={styles.headerActions}>
          {activeTab === 'error_handling' ? (
            <>
              <span className={`${styles.statusBadge} ${failureStatusClass}`}>
                {failureStatusText}
              </span>
              <Button
                variant="secondary"
                onClick={handleFailureReload}
                disabled={failureLoading || failureSaving}
              >
                <IconRefreshCw size={16} />
                {t('codex_config.failure.reload')}
              </Button>
              <Button
                onClick={handleFailureSave}
                disabled={failureDisabled || !failureDirty}
                loading={failureSaving}
              >
                {t('codex_config.failure.save')}
              </Button>
            </>
          ) : activeTab === 'routing' ? (
            <>
              <span className={`${styles.statusBadge} ${routingStatusClass}`}>
                {routingStatusText}
              </span>
              <Button
                variant="secondary"
                onClick={handleRoutingReload}
                disabled={routingLoading || routingSaving}
              >
                <IconRefreshCw size={16} />
                {t('codex_config.routing.reload')}
              </Button>
              <Button
                onClick={handleRoutingSave}
                disabled={routingDisabled || !routingDirty}
                loading={routingSaving}
              >
                {t('codex_config.routing.save')}
              </Button>
            </>
          ) : (
            <>
              <span className={`${styles.statusBadge} ${instrStatusClass}`}>{instrStatusText}</span>
              <Button
                variant="secondary"
                onClick={handleInstrReload}
                disabled={instrLoading || instrSaving}
              >
                <IconRefreshCw size={16} />
                {t('codex_instructions.reload')}
              </Button>
              <Button
                onClick={handleInstrSave}
                disabled={instrDisabled || !instrDirty}
                loading={instrSaving}
              >
                {t('codex_instructions.save')}
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'error_handling' && (
        <div role="tabpanel" aria-label={t('codex_config.tabs.error_handling')}>
          {failureError && <div className="error-box">{failureError}</div>}

          <div className={styles.policyStrip} aria-label={t('codex_config.failure.policy_summary')}>
            <span>{t('codex_config.failure.policy_runtime')}</span>
            <span>
              {t('codex_config.failure.policy_auth', {
                count: failureDraft.authFailureDisableAfter,
                enabled: failureDraft.autoDisableAuthFailures,
              })}
            </span>
            <span>
              {t('codex_config.failure.policy_usage_limit', {
                count: failureDraft.usageLimitDisableAfter,
                hours: failureDraft.usageLimitCooldownFallbackHours,
              })}
            </span>
            <span>{t('codex_config.failure.policy_rate_limit')}</span>
          </div>

          <section
            className={styles.failureSettings}
            aria-label={t('codex_config.failure.settings_title')}
          >
            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <div>
                  <h2>{t('codex_config.failure.auto_disable_label')}</h2>
                  <p className={styles.settingHint}>
                    {t('codex_config.failure.auto_disable_hint')}
                  </p>
                </div>
                <ToggleSwitch
                  checked={failureDraft.autoDisableAuthFailures}
                  onChange={(autoDisableAuthFailures) => updateFailure({ autoDisableAuthFailures })}
                  disabled={failureDisabled}
                  ariaLabel={t('codex_config.failure.auto_disable_label')}
                />
              </div>
              <div className={styles.reasonNote}>{t('codex_config.failure.reason_note')}</div>
              <div
                className={`${styles.counterField} ${
                  !failureDraft.autoDisableAuthFailures ? styles.dependentDisabled : ''
                }`}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.auth_disable_after')}
                  value={String(failureDraft.authFailureDisableAfter)}
                  onChange={(event) =>
                    updateFailureNumber('authFailureDisableAfter', event.target.value)
                  }
                  disabled={failureDisabled || !failureDraft.autoDisableAuthFailures}
                />
                <p className={styles.fieldHint}>
                  {t('codex_config.failure.auth_disable_after_hint')}
                </p>
              </div>
            </div>

            <div className={styles.cooldownGrid}>
              <div className={styles.settingCard}>
                <h2>{t('codex_config.failure.usage_limit_label')}</h2>
                <p className={styles.settingHint}>{t('codex_config.failure.usage_limit_hint')}</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.disable_after')}
                  value={String(failureDraft.usageLimitDisableAfter)}
                  onChange={(event) =>
                    updateFailureNumber('usageLimitDisableAfter', event.target.value)
                  }
                  disabled={failureDisabled}
                />
                <p className={styles.fieldHint}>{t('codex_config.failure.disable_after_hint')}</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.fallback_hours')}
                  value={String(failureDraft.usageLimitCooldownFallbackHours)}
                  onChange={(event) =>
                    updateFailureNumber('usageLimitCooldownFallbackHours', event.target.value)
                  }
                  disabled={failureDisabled}
                />
                <p className={styles.fieldHint}>{t('codex_config.failure.fallback_hours_hint')}</p>
              </div>
              <div className={styles.settingCard}>
                <h2>{t('codex_config.failure.rate_limit_label')}</h2>
                <p className={styles.settingHint}>{t('codex_config.failure.rate_limit_hint')}</p>
                <div className={styles.reasonNote}>{t('codex_config.failure.rate_limit_note')}</div>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'routing' && (
        <div role="tabpanel" aria-label={t('codex_config.tabs.routing')}>
          {routingError && <div className="error-box">{routingError}</div>}

          <div
            className={`${styles.policyStrip} ${styles.routingFlow}`}
            aria-label={t('codex_config.routing.flow_summary')}
          >
            <span>{t('codex_config.routing.flow_request')}</span>
            <span>{t('codex_config.routing.flow_free')}</span>
            <span>{t('codex_config.routing.flow_paid')}</span>
          </div>

          <section
            className={styles.failureSettings}
            aria-label={t('codex_config.routing.settings_title')}
          >
            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <div>
                  <h2>{t('codex_config.routing.strategy_label')}</h2>
                  <p className={styles.settingHint}>{t('codex_config.routing.strategy_hint')}</p>
                </div>
                <Select
                  value={routingDraft.strategy}
                  options={[
                    {
                      value: '',
                      label: t('codex_config.routing.strategy_global'),
                    },
                    {
                      value: 'adaptive',
                      label: t('codex_config.routing.strategy_adaptive'),
                    },
                  ]}
                  onChange={(strategy) =>
                    setRoutingDraft((current) => ({
                      ...current,
                      strategy: strategy === 'adaptive' ? 'adaptive' : '',
                    }))
                  }
                  disabled={routingDisabled}
                  ariaLabel={t('codex_config.routing.strategy_label')}
                />
              </div>
              <div className={styles.reasonNote}>{t('codex_config.routing.strategy_note')}</div>
            </div>

            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <div>
                  <h2>{t('codex_config.routing.prefer_free_label')}</h2>
                  <p className={styles.settingHint}>{t('codex_config.routing.prefer_free_hint')}</p>
                </div>
                <ToggleSwitch
                  checked={routingDraft.preferFreeForSharedModels}
                  onChange={(preferFreeForSharedModels) =>
                    setRoutingDraft((current) => ({ ...current, preferFreeForSharedModels }))
                  }
                  disabled={routingDisabled}
                  ariaLabel={t('codex_config.routing.prefer_free_label')}
                />
              </div>
              <div className={styles.reasonNote}>{t('codex_config.routing.fallback_note')}</div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'instructions' && (
        <div role="tabpanel" aria-label={t('codex_config.tabs.instructions')}>
          {instrError && <div className="error-box">{instrError}</div>}

          <div className={styles.workspace}>
            <section
              className={styles.settingsPanel}
              aria-label={t('codex_instructions.settings_title')}
            >
              <div className={styles.settingCard}>
                <div className={styles.settingHeader}>
                  <h2>{t('codex_instructions.settings_title')}</h2>
                  <ToggleSwitch
                    checked={instrDraft.enabled}
                    onChange={(enabled) => updateInstrDraft({ enabled })}
                    disabled={instrDisabled}
                    ariaLabel={t('codex_instructions.enabled')}
                  />
                </div>
                <p className={styles.settingHint}>{t('codex_instructions.enabled_hint')}</p>
              </div>

              <label className={styles.fieldGroup}>
                <span>{t('codex_instructions.mode_label')}</span>
                <Select
                  value={instrDraft.mode}
                  options={modeOptions}
                  onChange={(mode) => updateInstrDraft({ mode: mode as CodexInstructionsMode })}
                  disabled={instrDisabled}
                  ariaLabel={t('codex_instructions.mode_label')}
                />
                <small>{t('codex_instructions.mode_hint')}</small>
              </label>

              <div className={styles.fieldGroup}>
                <ToggleSwitch
                  checked={instrDraft.oauthOnly}
                  onChange={(oauthOnly) => updateInstrDraft({ oauthOnly })}
                  disabled={instrDisabled}
                  label={t('codex_instructions.oauth_only')}
                />
                <small>{t('codex_instructions.oauth_only_hint')}</small>
              </div>

              <label className={styles.fieldGroup}>
                <span>{t('codex_instructions.models_label')}</span>
                <textarea
                  className={styles.modelsTextarea}
                  value={modelsInput}
                  onChange={(event) => setModelsInput(event.target.value)}
                  disabled={instrDisabled}
                  rows={4}
                  placeholder="gpt-5.5\ngpt-5*"
                />
                <small>{t('codex_instructions.models_hint')}</small>
              </label>

              <div
                className={styles.modelChips}
                aria-label={t('codex_instructions.models_preview')}
              >
                {modelChips.map((model) => (
                  <span key={model}>{model}</span>
                ))}
              </div>

              <Input
                label={t('codex_instructions.file_label')}
                value={instrDraft.file}
                onChange={(event) => updateInstrDraft({ file: event.target.value })}
                disabled={instrDisabled}
                placeholder="/home/me/codex-instructions.md"
                hint={t('codex_instructions.file_hint')}
              />
            </section>

            <section
              className={styles.editorPanel}
              aria-label={t('codex_instructions.editor_title')}
            >
              <div className={styles.editorHeader}>
                <div>
                  <h2>{t('codex_instructions.editor_title')}</h2>
                  <p>{t('codex_instructions.editor_hint')}</p>
                </div>
                <span className={styles.fileBadge}>instructions.md</span>
              </div>

              <div className={styles.editorWrapper}>
                <Suspense fallback={null}>
                  <LazyMarkdownSourceEditor
                    editorRef={editorRef}
                    value={instrDraft.content}
                    onChange={(content) => updateInstrDraft({ content })}
                    theme={resolvedTheme}
                    editable={!instrDisabled}
                    placeholder={t('codex_instructions.editor_placeholder')}
                  />
                </Suspense>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
