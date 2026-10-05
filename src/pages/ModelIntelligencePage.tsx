import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChartScatter, IconExternalLink, IconKey, IconRefreshCw } from '@/components/ui/icons';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { modelIntelligenceApi } from '@/services/api/modelIntelligence';
import { useAuthStore, useModelsStore, useNotificationStore } from '@/stores';
import type { ApiError } from '@/types';
import type {
  ModelIntelligenceData,
  ModelIntelligenceModel,
  ModelIntelligenceTier,
} from '@/types/modelIntelligence';
import { formatRelativeTimeLabel } from '@/utils/format';
import { isRecord } from '@/utils/helpers';
import {
  ARTIFICIAL_ANALYSIS_KEY_URL,
  ARTIFICIAL_ANALYSIS_URL,
  X_AXES,
  Y_AXES,
  buildChartPoints,
  buildProxyModelIndex,
  createScale,
  defaultSortDirection,
  filterModels,
  formatIndex,
  formatPlain,
  formatUsd,
  getXAxis,
  getYAxis,
  isModelInProxy,
  sortModels,
  summarizeCreators,
  UNKNOWN_CREATOR,
  type ChartPoint,
  type CreatorSummary,
  type SortDirection,
  type SortKey,
  type XAxisKey,
  type YAxisKey,
} from './modelIntelligence';
import styles from './ModelIntelligencePage.module.scss';

interface LoadError {
  kind: 'upstream' | 'rate_limited' | 'not_supported' | 'generic';
  message: string;
  upstreamStatus?: number;
  retryAfter?: number;
}

const toLoadError = (error: unknown): LoadError => {
  const apiError = error as ApiError;
  const body = isRecord(apiError?.data) ? apiError.data : {};
  const message = apiError instanceof Error ? apiError.message : String(error ?? '');
  const status = apiError?.status;
  if (status === 429) {
    const retryAfter = Number(body.retry_after);
    return {
      kind: 'rate_limited',
      message,
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined,
    };
  }
  if (status === 502) {
    const upstream = Number(body.upstream_status);
    return {
      kind: 'upstream',
      message,
      upstreamStatus: Number.isFinite(upstream) && upstream > 0 ? upstream : undefined,
    };
  }
  if (status === 404) return { kind: 'not_supported', message };
  return { kind: 'generic', message };
};

const formatContext = (value: number | null): string => {
  if (value === null || value <= 0) return '—';
  if (value >= 1_000_000) return `${formatPlain(value / 1_000_000, 2)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
};

const formatDate = (value: string | null): string => {
  if (!value) return '—';
  const match = /^\d{4}-\d{2}(-\d{2})?/.exec(value);
  return match ? match[0] : value;
};

const dash = (value: number | null, format: (v: number) => string) =>
  value === null ? '—' : format(value);

const colorVar = (index: number) => (index >= 0 ? `var(--mi-c${index})` : 'var(--mi-other)');

// ---------------------------------------------------------------------------
// Scatter chart
// ---------------------------------------------------------------------------

const CHART_PAD = { top: 14, right: 18, bottom: 40, left: 46 };

interface ScatterChartProps {
  points: ChartPoint[];
  xAxis: XAxisKey;
  yAxis: YAxisKey;
  colorOf: (model: ModelIntelligenceModel) => string;
  isGrey: (model: ModelIntelligenceModel) => boolean;
  inProxy: (model: ModelIntelligenceModel) => boolean;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  creatorLabel: (name: string) => string;
}

function ScatterChart({
  points,
  xAxis,
  yAxis,
  colorOf,
  isGrey,
  inProxy,
  highlightedId,
  onHighlight,
  creatorLabel,
}: ScatterChartProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(280, Math.floor(node.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const xDef = getXAxis(xAxis);
  const yDef = getYAxis(yAxis);
  const height = width < 560 ? 300 : 380;
  const plotW = width - CHART_PAD.left - CHART_PAD.right;
  const plotH = height - CHART_PAD.top - CHART_PAD.bottom;

  const xScale = useMemo(
    () =>
      createScale(
        xDef.scale,
        points.map((p) => p.x)
      ),
    [points, xDef.scale]
  );
  const yScale = useMemo(
    () =>
      createScale(
        'linear',
        points.map((p) => p.y)
      ),
    [points]
  );

  const px = (value: number) => CHART_PAD.left + (xScale.position(value) ?? 0) * plotW;
  const py = (value: number) => CHART_PAD.top + (1 - (yScale.position(value) ?? 0)) * plotH;

  // Grey first, coloured on top, highlighted last.
  const ordered = useMemo(() => {
    const grey = points.filter((p) => isGrey(p.model));
    const coloured = points.filter((p) => !isGrey(p.model));
    const all = [...grey, ...coloured];
    const index = all.findIndex((p) => p.model.id === highlightedId);
    if (index >= 0) all.push(all.splice(index, 1)[0]);
    return all;
  }, [points, isGrey, highlightedId]);

  const highlighted = points.find((p) => p.model.id === highlightedId) ?? null;
  const yLabel = t(`model_intelligence.y_${yAxis}`);
  const xLabel = t(`model_intelligence.x_${xAxis}`);
  const hint = t(`model_intelligence.hint_${xDef.hint}`);

  let tooltipStyle: CSSProperties | undefined;
  if (highlighted) {
    const x = px(highlighted.x);
    const y = py(highlighted.y);
    const flipX = x > width * 0.6;
    tooltipStyle = {
      left: flipX ? undefined : x + 12,
      right: flipX ? width - x + 12 : undefined,
      top: Math.max(4, Math.min(y - 12, height - 120)),
    };
  }

  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <span className={styles.chartHint}>{hint}</span>
      {points.length === 0 ? (
        <div className={styles.chartEmpty} style={{ height }}>
          {t('model_intelligence.no_points')}
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={t('model_intelligence.chart_label', { x: xLabel, y: yLabel })}
          className={styles.chartSvg}
          onMouseLeave={() => onHighlight(null)}
        >
          {yScale.ticks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className={styles.grid}
                x1={CHART_PAD.left}
                x2={width - CHART_PAD.right}
                y1={py(tick)}
                y2={py(tick)}
              />
              <text
                className={styles.tick}
                x={CHART_PAD.left - 8}
                y={py(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {formatPlain(tick)}
              </text>
            </g>
          ))}
          {xScale.ticks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                className={styles.grid}
                x1={px(tick)}
                x2={px(tick)}
                y1={CHART_PAD.top}
                y2={height - CHART_PAD.bottom}
              />
              <text
                className={styles.tick}
                x={px(tick)}
                y={height - CHART_PAD.bottom + 16}
                textAnchor="middle"
              >
                {xDef.format(tick)}
              </text>
            </g>
          ))}
          <line
            className={styles.axis}
            x1={CHART_PAD.left}
            x2={width - CHART_PAD.right}
            y1={height - CHART_PAD.bottom}
            y2={height - CHART_PAD.bottom}
          />
          <text
            className={styles.axisLabel}
            x={CHART_PAD.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
          >
            {xLabel}
            {xDef.scale === 'log' ? ` · ${t('model_intelligence.log_scale')}` : ''}
          </text>
          <text
            className={styles.axisLabel}
            transform={`translate(12 ${CHART_PAD.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
          {ordered.map((point) => {
            const active = point.model.id === highlightedId;
            const cx = px(point.x);
            const cy = py(point.y);
            return (
              <g
                key={point.model.id}
                className={styles.point}
                tabIndex={0}
                role="img"
                aria-label={`${point.model.name}, ${creatorLabel(point.model.creator.name)}, ${yLabel} ${yDef.format(point.y)}, ${xLabel} ${xDef.format(point.x)}`}
                onMouseEnter={() => onHighlight(point.model.id)}
                onFocus={() => onHighlight(point.model.id)}
                onBlur={() => onHighlight(null)}
              >
                <circle cx={cx} cy={cy} r={11} className={styles.hit} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={active ? 6.5 : 4.5}
                  fill={colorOf(point.model)}
                  className={`${styles.dot} ${active ? styles.dotActive : ''}`}
                />
                {inProxy(point.model) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={active ? 9.5 : 7.5}
                    className={styles.proxyRing}
                    stroke={colorOf(point.model)}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {highlighted && (
        <div className={styles.tooltip} style={tooltipStyle} role="status">
          <strong>{highlighted.model.name}</strong>
          <span className={styles.tooltipCreator}>
            <i style={{ background: colorOf(highlighted.model) }} aria-hidden="true" />
            {creatorLabel(highlighted.model.creator.name)}
            {inProxy(highlighted.model) && (
              <span className={styles.proxyBadge}>{t('model_intelligence.in_proxy')}</span>
            )}
          </span>
          <dl>
            <dt>{yLabel}</dt>
            <dd>{yDef.format(highlighted.y)}</dd>
            <dt>{xLabel}</dt>
            <dd>{xDef.format(highlighted.x)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API key form
// ---------------------------------------------------------------------------

function ApiKeyForm({
  initialTier,
  canClear,
  onSaved,
  onCancel,
}: {
  initialTier: ModelIntelligenceTier;
  canClear: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [apiKey, setApiKey] = useState('');
  const [tier, setTier] = useState<ModelIntelligenceTier>(initialTier);
  const [saving, setSaving] = useState(false);

  const save = async (value: string) => {
    setSaving(true);
    try {
      await modelIntelligenceApi.saveConfig({ api_key: value, tier });
      showNotification(
        t(value ? 'model_intelligence.key_saved' : 'model_intelligence.key_cleared'),
        'success'
      );
      setApiKey('');
      onSaved();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      showNotification(`${t('model_intelligence.key_save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = apiKey.trim();
    if (!value) {
      showNotification(t('model_intelligence.key_required'), 'warning');
      return;
    }
    void save(value);
  };

  return (
    <form className={styles.keyForm} onSubmit={onSubmit}>
      <div className={styles.keyRow}>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          label={t('model_intelligence.key_label')}
          placeholder={t('model_intelligence.key_placeholder')}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={saving}
        />
        <label className={styles.tierField}>
          <span>{t('model_intelligence.tier_label')}</span>
          <Select
            size="sm"
            value={tier}
            onChange={(value) => setTier(value === 'pro' ? 'pro' : 'free')}
            options={[
              { value: 'free', label: t('model_intelligence.tier_free') },
              { value: 'pro', label: t('model_intelligence.tier_pro') },
            ]}
            ariaLabel={t('model_intelligence.tier_label')}
            disabled={saving}
          />
        </label>
        <div className={styles.keyActions}>
          <Button type="submit" loading={saving} disabled={saving}>
            {t('model_intelligence.save_key')}
          </Button>
          {canClear && (
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void save('')}
            >
              {t('model_intelligence.clear_key')}
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
              {t('model_intelligence.cancel')}
            </Button>
          )}
        </div>
      </div>
      <p className={styles.keyNote}>
        <Trans i18nKey="model_intelligence.key_alternative" components={{ code: <code /> }} />
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABLE_COLUMNS: ReadonlyArray<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'name', label: 'col_model', numeric: false },
  { key: 'creator', label: 'col_creator', numeric: false },
  { key: 'intelligence', label: 'col_intelligence', numeric: true },
  { key: 'coding', label: 'col_coding', numeric: true },
  { key: 'agentic', label: 'col_agentic', numeric: true },
  { key: 'price_blended', label: 'col_blended', numeric: true },
  { key: 'price_input', label: 'col_input', numeric: true },
  { key: 'price_output', label: 'col_output', numeric: true },
  { key: 'speed', label: 'col_speed', numeric: true },
  { key: 'ttft', label: 'col_ttft', numeric: true },
  { key: 'context', label: 'col_context', numeric: true },
  { key: 'released', label: 'col_released', numeric: true },
];

const VISIBLE_CREATOR_CHIPS = 12;

export function ModelIntelligencePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const proxyModels = useModelsStore((state) => state.models);
  const proxyModelsError = useModelsStore((state) => state.error);
  const fetchProxyModels = useModelsStore((state) => state.fetchModels);
  const resolveApiKeysForModels = useApiKeysForModels();

  const [data, setData] = useState<ModelIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [editingKey, setEditingKey] = useState(false);

  const [xAxis, setXAxis] = useState<XAxisKey>('price_blended');
  const [yAxis, setYAxis] = useState<YAxisKey>('intelligence');
  const [search, setSearch] = useState('');
  const [hiddenCreators, setHiddenCreators] = useState<Set<string>>(() => new Set());
  const [onlyInProxy, setOnlyInProxy] = useState(false);
  const [showAllCreators, setShowAllCreators] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('intelligence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const requestRef = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const request = ++requestRef.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await modelIntelligenceApi.get(refresh);
      if (request !== requestRef.current) return;
      setData(next);
      setError(null);
      setNow(Date.now());
    } catch (loadError: unknown) {
      if (request !== requestRef.current) return;
      setError(toLoadError(loadError));
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    void load();
  }, [connectionStatus, load]);

  // Proxy model list (same source as the dashboard's "Available Models").
  const loadProxyModels = useCallback(
    async (force = false) => {
      if (connectionStatus !== 'connected' || !apiBase) return;
      try {
        const keys = await resolveApiKeysForModels({ force });
        await fetchProxyModels(apiBase, keys[0], force);
      } catch {
        // Surfaced through the models store error.
      }
    },
    [apiBase, connectionStatus, fetchProxyModels, resolveApiKeysForModels]
  );

  useEffect(() => {
    void loadProxyModels();
  }, [loadProxyModels]);

  // Header "refresh all": re-read the backend cache (no forced upstream fetch,
  // which costs Artificial Analysis quota) and the proxy model list.
  const headerRefresh = useCallback(
    () => Promise.all([load(false), loadProxyModels(true)]).then(() => undefined),
    [load, loadProxyModels]
  );
  useHeaderRefresh(headerRefresh);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const models = useMemo(() => data?.models ?? [], [data]);
  const proxyIndex = useMemo(() => buildProxyModelIndex(proxyModels), [proxyModels]);
  const inProxy = useCallback(
    (model: ModelIntelligenceModel) => isModelInProxy(model, proxyIndex),
    [proxyIndex]
  );
  const creators = useMemo(() => summarizeCreators(models), [models]);
  const creatorColor = useMemo(() => {
    const map = new Map<string, number>();
    creators.forEach((creator) => map.set(creator.name, creator.colorIndex));
    return map;
  }, [creators]);
  const colorIndexOf = useCallback(
    (model: ModelIntelligenceModel) =>
      creatorColor.get(model.creator.name || UNKNOWN_CREATOR) ?? -1,
    [creatorColor]
  );
  const colorOf = useCallback(
    (model: ModelIntelligenceModel) => colorVar(colorIndexOf(model)),
    [colorIndexOf]
  );
  const isGrey = useCallback(
    (model: ModelIntelligenceModel) => colorIndexOf(model) < 0,
    [colorIndexOf]
  );
  const creatorLabel = useCallback(
    (name: string) => name || t('model_intelligence.unknown_creator'),
    [t]
  );

  const visibleModels = useMemo(
    () => filterModels(models, { search, hiddenCreators, onlyInProxy, inProxy }),
    [hiddenCreators, inProxy, models, onlyInProxy, search]
  );
  const points = useMemo(
    () => buildChartPoints(visibleModels, xAxis, yAxis),
    [visibleModels, xAxis, yAxis]
  );
  const sortedModels = useMemo(
    () => sortModels(visibleModels, sortKey, sortDirection),
    [sortDirection, sortKey, visibleModels]
  );

  const paletteCreators = creators.filter((creator) => creator.colorIndex >= 0);
  const otherCreators = creators.filter((creator) => creator.colorIndex < 0);
  const otherHidden =
    otherCreators.length > 0 && otherCreators.every((c) => hiddenCreators.has(c.name));

  const toggleCreators = (names: string[]) => {
    setHiddenCreators((current) => {
      const next = new Set(current);
      const allHidden = names.every((name) => next.has(name));
      names.forEach((name) => (allHidden ? next.delete(name) : next.add(name)));
      return next;
    });
  };

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(defaultSortDirection(key));
    }
  };

  const errorMessage = (loadError: LoadError): string => {
    switch (loadError.kind) {
      case 'upstream':
        return t('model_intelligence.error_upstream', {
          status: loadError.upstreamStatus ?? '?',
          message: loadError.message,
        });
      case 'rate_limited':
        return loadError.retryAfter
          ? t('model_intelligence.error_rate_limited', { seconds: loadError.retryAfter })
          : t('model_intelligence.error_rate_limited_generic');
      case 'not_supported':
        return t('model_intelligence.error_not_supported');
      default:
        return loadError.message;
    }
  };

  const configured = data?.configured === true;
  // The key can be changed once configured, and also from an error state (e.g. a
  // rejected key surfaces as 502) unless the setup card is already showing.
  const canEditKey =
    configured || (error !== null && error.kind !== 'not_supported' && data === null);
  const updatedLabel = data?.fetchedAt
    ? t('model_intelligence.updated', { time: formatRelativeTimeLabel(t, data.fetchedAt, now) })
    : t('model_intelligence.updated_unknown');
  const xOptions = X_AXES.map((axis) => ({
    value: axis.key,
    label: `${t(`model_intelligence.x_${axis.key}`)}${axis.scale === 'log' ? ` (${t('model_intelligence.log_scale')})` : ''}`,
  }));
  const yOptions = Y_AXES.map((axis) => ({
    value: axis.key,
    label: t(`model_intelligence.y_${axis.key}`),
  }));
  const creatorChips: CreatorSummary[] = showAllCreators
    ? creators
    : creators.slice(0, VISIBLE_CREATOR_CHIPS);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.headerText}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconChartScatter size={20} />
            </span>
            <h1>{t('model_intelligence.title')}</h1>
          </div>
          <p>{t('model_intelligence.description')}</p>
          <div className={styles.metaRow}>
            <a
              className={styles.attribution}
              href={data?.source.url || ARTIFICIAL_ANALYSIS_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t('model_intelligence.attribution_link')}
              <IconExternalLink size={12} />
            </a>
            {configured && (
              <>
                <span className={styles.metaSep} aria-hidden="true">
                  ·
                </span>
                <span title={data?.fetchedAt ?? undefined}>{updatedLabel}</span>
                {data?.tier && (
                  <span className={styles.metaPill}>
                    {t('model_intelligence.tier', { tier: data.tier })}
                  </span>
                )}
                {data?.cached && (
                  <span className={styles.metaPill}>{t('model_intelligence.cached')}</span>
                )}
                <span className={styles.metaSep} aria-hidden="true">
                  ·
                </span>
                <span>{t('model_intelligence.models_count', { count: models.length })}</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          {canEditKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingKey((v) => !v)}
              aria-expanded={editingKey}
            >
              <IconKey size={14} />
              {t('model_intelligence.change_key')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(true)}
            disabled={loading || refreshing || (data !== null && !configured)}
            loading={refreshing}
          >
            {!refreshing && <IconRefreshCw size={14} />}
            {t('model_intelligence.refresh')}
          </Button>
        </div>
      </div>

      {canEditKey && editingKey && (
        <section className={styles.card}>
          {data?.keySource && (
            <p className={styles.keySource}>
              {data.keySource === 'env'
                ? t('model_intelligence.key_source_env')
                : t('model_intelligence.key_source_config')}
            </p>
          )}
          <ApiKeyForm
            initialTier={data?.tier === 'pro' ? 'pro' : 'free'}
            canClear={data?.keySource !== 'env'}
            onSaved={() => {
              setEditingKey(false);
              void load(true);
            }}
            onCancel={() => setEditingKey(false)}
          />
        </section>
      )}

      {error && (
        <div className={styles.errorBox} role="alert">
          <div>
            <strong>{t('model_intelligence.error_title')}</strong>
            <p>{errorMessage(error)}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(data !== null)}
            disabled={loading || refreshing}
          >
            {t('model_intelligence.retry')}
          </Button>
        </div>
      )}

      {data?.warning && (
        <div className={styles.warningBox}>
          {t('model_intelligence.warning', { message: data.warning })}
        </div>
      )}

      {loading && !data ? (
        <div className={styles.skeletonStack} aria-busy="true">
          <Skeleton height={36} />
          <Skeleton height={340} />
          <Skeleton height={28} />
          <Skeleton height={28} />
          <Skeleton height={28} />
        </div>
      ) : data && !configured ? (
        <section className={`${styles.card} ${styles.setupCard}`}>
          <h2>{t('model_intelligence.setup_title')}</h2>
          <p>{t('model_intelligence.setup_body')}</p>
          <a
            className={styles.setupLink}
            href={ARTIFICIAL_ANALYSIS_KEY_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('model_intelligence.setup_get_key')}
            <IconExternalLink size={12} />
          </a>
          <ApiKeyForm initialTier="free" canClear={false} onSaved={() => void load(true)} />
        </section>
      ) : data ? (
        <>
          <section className={styles.card}>
            <div className={styles.filters}>
              <div className={styles.filterSearch}>
                <Input
                  type="search"
                  value={search}
                  placeholder={t('model_intelligence.search_placeholder')}
                  aria-label={t('model_intelligence.search_placeholder')}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <ToggleSwitch
                checked={onlyInProxy}
                onChange={setOnlyInProxy}
                label={t('model_intelligence.only_in_proxy')}
              />
            </div>
            {proxyModelsError && (
              <p className={styles.subtleNote}>
                {t('model_intelligence.proxy_models_unavailable')}
              </p>
            )}
            {creators.length > 0 && (
              <div
                className={styles.creatorChips}
                role="group"
                aria-label={t('model_intelligence.creators_label')}
              >
                {creatorChips.map((creator) => {
                  const hidden = hiddenCreators.has(creator.name);
                  return (
                    <button
                      type="button"
                      key={creator.name || '__unknown'}
                      className={`${styles.chip} ${hidden ? styles.chipOff : ''}`}
                      aria-pressed={!hidden}
                      onClick={() => toggleCreators([creator.name])}
                    >
                      <i style={{ background: colorVar(creator.colorIndex) }} aria-hidden="true" />
                      {creatorLabel(creator.name)}
                      <span className={styles.chipCount}>{creator.count}</span>
                    </button>
                  );
                })}
                {creators.length > VISIBLE_CREATOR_CHIPS && (
                  <button
                    type="button"
                    className={styles.chipLink}
                    onClick={() => setShowAllCreators((v) => !v)}
                  >
                    {showAllCreators
                      ? t('model_intelligence.fewer_creators')
                      : t('model_intelligence.more_creators', {
                          count: creators.length - VISIBLE_CREATOR_CHIPS,
                        })}
                  </button>
                )}
                {hiddenCreators.size > 0 && (
                  <button
                    type="button"
                    className={styles.chipLink}
                    onClick={() => setHiddenCreators(new Set())}
                  >
                    {t('model_intelligence.show_all')}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.chartControls}>
              <label className={styles.axisField}>
                <span>{t('model_intelligence.y_axis')}</span>
                <Select
                  size="sm"
                  value={yAxis}
                  options={yOptions}
                  onChange={(value) => setYAxis(value as YAxisKey)}
                  ariaLabel={t('model_intelligence.y_axis')}
                />
              </label>
              <label className={styles.axisField}>
                <span>{t('model_intelligence.x_axis')}</span>
                <Select
                  size="sm"
                  value={xAxis}
                  options={xOptions}
                  onChange={(value) => setXAxis(value as XAxisKey)}
                  ariaLabel={t('model_intelligence.x_axis')}
                />
              </label>
              <span className={styles.plotted}>
                {t('model_intelligence.plotted', {
                  count: points.length,
                  total: visibleModels.length,
                })}
              </span>
            </div>
            <ScatterChart
              points={points}
              xAxis={xAxis}
              yAxis={yAxis}
              colorOf={colorOf}
              isGrey={isGrey}
              inProxy={inProxy}
              highlightedId={highlightedId}
              onHighlight={setHighlightedId}
              creatorLabel={creatorLabel}
            />
            {creators.length > 0 && (
              <div
                className={styles.legend}
                role="group"
                aria-label={t('model_intelligence.legend_label')}
              >
                {paletteCreators.map((creator) => {
                  const hidden = hiddenCreators.has(creator.name);
                  return (
                    <button
                      type="button"
                      key={creator.name}
                      className={`${styles.legendItem} ${hidden ? styles.legendOff : ''}`}
                      aria-pressed={!hidden}
                      onClick={() => toggleCreators([creator.name])}
                    >
                      <i style={{ background: colorVar(creator.colorIndex) }} aria-hidden="true" />
                      {creatorLabel(creator.name)}
                    </button>
                  );
                })}
                {otherCreators.length > 0 && (
                  <button
                    type="button"
                    className={`${styles.legendItem} ${otherHidden ? styles.legendOff : ''}`}
                    aria-pressed={!otherHidden}
                    onClick={() => toggleCreators(otherCreators.map((c) => c.name))}
                  >
                    <i style={{ background: colorVar(-1) }} aria-hidden="true" />
                    {t('model_intelligence.other_creators')} ({otherCreators.length})
                  </button>
                )}
                <span className={styles.legendNote}>
                  <span className={styles.legendRing} aria-hidden="true" />
                  {t('model_intelligence.in_proxy')}
                </span>
              </div>
            )}
          </section>

          <section className={`${styles.card} ${styles.tableCard}`}>
            {sortedModels.length === 0 ? (
              <div className={styles.emptyState}>
                {models.length === 0
                  ? t('model_intelligence.empty')
                  : t('model_intelligence.empty_filtered')}
              </div>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((column) => {
                        const active = column.key === sortKey;
                        const label = t(`model_intelligence.${column.label}`);
                        return (
                          <th
                            key={column.key}
                            className={column.numeric ? styles.num : undefined}
                            aria-sort={
                              active
                                ? sortDirection === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                          >
                            <button
                              type="button"
                              className={`${styles.sortButton} ${active ? styles.sortActive : ''}`}
                              onClick={() => onSort(column.key)}
                              title={t('model_intelligence.sort_by', { column: label })}
                            >
                              {label}
                              <span className={styles.sortArrow} aria-hidden="true">
                                {active ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                              </span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.map((model) => {
                      const available = inProxy(model);
                      return (
                        <tr
                          key={model.id}
                          className={model.id === highlightedId ? styles.rowActive : undefined}
                          onMouseEnter={() => setHighlightedId(model.id)}
                          onMouseLeave={() => setHighlightedId(null)}
                        >
                          <td className={styles.modelCell}>
                            <span className={styles.modelName}>{model.name}</span>
                            {available && (
                              <span className={styles.proxyBadge}>
                                {t('model_intelligence.in_proxy')}
                              </span>
                            )}
                            {model.reasoning && (
                              <span className={styles.tag}>
                                {t('model_intelligence.reasoning')}
                              </span>
                            )}
                            {model.openWeights && (
                              <span className={styles.tag}>
                                {t('model_intelligence.open_weights')}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={styles.creatorCell}>
                              <i style={{ background: colorOf(model) }} aria-hidden="true" />
                              {creatorLabel(model.creator.name)}
                            </span>
                          </td>
                          <td className={styles.num}>
                            {dash(model.intelligenceIndex, formatIndex)}
                          </td>
                          <td className={styles.num}>{dash(model.codingIndex, formatIndex)}</td>
                          <td className={styles.num}>{dash(model.agenticIndex, formatIndex)}</td>
                          <td className={styles.num}>{dash(model.priceBlended, formatUsd)}</td>
                          <td className={styles.num}>{dash(model.priceInput, formatUsd)}</td>
                          <td className={styles.num}>{dash(model.priceOutput, formatUsd)}</td>
                          <td className={styles.num}>
                            {dash(model.outputTokensPerSecond, (v) => formatPlain(v, 0))}
                          </td>
                          <td className={styles.num}>
                            {dash(model.timeToFirstToken, (v) => formatPlain(v, 2))}
                          </td>
                          <td className={styles.num}>{formatContext(model.contextWindow)}</td>
                          <td className={styles.num}>{formatDate(model.releaseDate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      <footer className={styles.footer}>
        <a href={ARTIFICIAL_ANALYSIS_URL} target="_blank" rel="noreferrer">
          {t('model_intelligence.footer')}
        </a>
        {data?.intelligenceIndexVersion && (
          <span>
            {' · '}
            {t('model_intelligence.index_version', { version: data.intelligenceIndexVersion })}
          </span>
        )}
      </footer>
    </div>
  );
}
