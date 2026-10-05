/**
 * Pure helpers for the Model Intelligence page: response parsing, proxy
 * availability matching, chart axes/scales, sorting and creator colours.
 * No React or network access here so everything is unit-testable.
 */

import { isRecord } from '@/utils/helpers';
import type {
  ModelIntelligenceData,
  ModelIntelligenceKeySource,
  ModelIntelligenceModel,
} from '@/types/modelIntelligence';

export const ARTIFICIAL_ANALYSIS_URL = 'https://artificialanalysis.ai';
export const ARTIFICIAL_ANALYSIS_KEY_URL = 'https://artificialanalysis.ai/data-api';

// ---------------------------------------------------------------------------
// Response parsing (tolerates missing / null / wrongly-typed fields)
// ---------------------------------------------------------------------------

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toStringOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const toText = (value: unknown): string => toStringOrNull(value) ?? '';

export function parseModelIntelligenceModel(raw: Record<string, unknown>): ModelIntelligenceModel {
  const creator = isRecord(raw.creator) ? raw.creator : {};
  const slug = toText(raw.slug);
  const id = toText(raw.id) || slug;
  return {
    id,
    name: toText(raw.name) || slug || id,
    slug,
    creator: {
      name: toText(creator.name) || toText(raw.creator_name),
      country: toStringOrNull(creator.country),
    },
    releaseDate: toStringOrNull(raw.release_date),
    reasoning: raw.reasoning === true,
    openWeights: typeof raw.open_weights === 'boolean' ? raw.open_weights : null,
    contextWindow: toNumberOrNull(raw.context_window),
    intelligenceIndex: toNumberOrNull(raw.intelligence_index),
    codingIndex: toNumberOrNull(raw.coding_index),
    agenticIndex: toNumberOrNull(raw.agentic_index),
    priceInput: toNumberOrNull(raw.price_input),
    priceOutput: toNumberOrNull(raw.price_output),
    priceBlended: toNumberOrNull(raw.price_blended),
    indexCost: toNumberOrNull(raw.index_cost),
    outputTokensPerSecond: toNumberOrNull(raw.output_tokens_per_second),
    timeToFirstToken: toNumberOrNull(raw.time_to_first_token),
    endToEndSeconds: toNumberOrNull(raw.end_to_end_seconds),
    openrouterId: toStringOrNull(raw.openrouter_id),
  };
}

export function parseModelIntelligenceResponse(raw: unknown): ModelIntelligenceData {
  const data = isRecord(raw) ? raw : {};
  const source = isRecord(data.source) ? data.source : {};
  const keySource = toText(data.key_source);
  const version = data.intelligence_index_version;
  return {
    configured: data.configured === true,
    keySource: (keySource === 'config' || keySource === 'env'
      ? keySource
      : '') as ModelIntelligenceKeySource,
    tier: toText(data.tier),
    intelligenceIndexVersion:
      version === null || version === undefined || version === '' ? null : String(version),
    fetchedAt: toStringOrNull(data.fetched_at),
    cached: data.cached === true,
    warning: toText(data.warning),
    source: {
      name: toText(source.name) || 'Artificial Analysis',
      url: toText(source.url) || ARTIFICIAL_ANALYSIS_URL,
    },
    models: Array.isArray(data.models)
      ? data.models
          .filter(isRecord)
          .map(parseModelIntelligenceModel)
          .filter((model) => model.id !== '' || model.name !== '')
      : [],
  };
}

// ---------------------------------------------------------------------------
// Proxy availability matching
// ---------------------------------------------------------------------------

/**
 * Normalise a model id for loose matching between proxy model ids and
 * Artificial Analysis slugs / OpenRouter ids. Deliberately simple:
 *
 * 1. lowercase and trim
 * 2. drop any provider/path prefix up to the last '/' (`anthropic/claude-x` → `claude-x`)
 * 3. drop an OpenRouter variant suffix after ':' (`model:free` → `model`)
 * 4. replace '.', '_' and whitespace with '-'
 * 5. drop a trailing date suffix: `-20250514` or `-2025-05-14`
 * 6. collapse repeated '-' and trim leading/trailing '-'
 *
 * It does NOT reorder tokens, so `claude-sonnet-4-5` and `claude-4-5-sonnet`
 * remain different ids.
 */
export function normalizeModelId(value: string | null | undefined): string {
  let id = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!id) return '';
  const slash = id.lastIndexOf('/');
  if (slash >= 0) id = id.slice(slash + 1);
  const colon = id.indexOf(':');
  if (colon >= 0) id = id.slice(0, colon);
  id = id.replace(/[._\s]+/g, '-');
  id = id.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return id.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

/** Normalised ids of every model the proxy exposes (names and aliases). */
export function buildProxyModelIndex(
  models: ReadonlyArray<{ name: string; alias?: string }>
): Set<string> {
  const index = new Set<string>();
  models.forEach((model) => {
    [model.name, model.alias].forEach((value) => {
      const normalized = normalizeModelId(value);
      if (normalized) index.add(normalized);
    });
  });
  return index;
}

/** Candidate ids for an Artificial Analysis model: slug, id and the OpenRouter model part. */
export function modelMatchKeys(
  model: Pick<ModelIntelligenceModel, 'id' | 'slug' | 'openrouterId'>
): string[] {
  const keys = [model.slug, model.id, model.openrouterId]
    .map((value) => normalizeModelId(value))
    .filter(Boolean);
  return Array.from(new Set(keys));
}

export function isModelInProxy(
  model: Pick<ModelIntelligenceModel, 'id' | 'slug' | 'openrouterId'>,
  proxyIndex: ReadonlySet<string>
): boolean {
  if (proxyIndex.size === 0) return false;
  return modelMatchKeys(model).some((key) => proxyIndex.has(key));
}

// ---------------------------------------------------------------------------
// Chart axes and scales
// ---------------------------------------------------------------------------

export type YAxisKey = 'intelligence' | 'coding' | 'agentic';
export type XAxisKey = 'price_blended' | 'index_cost' | 'speed' | 'ttft';
export type ScaleKind = 'linear' | 'log';
/** Which corner of the chart is "better" for the current X axis. */
export type AxisHint = 'upper_left' | 'upper_right';

export interface AxisDefinition<K extends string> {
  key: K;
  scale: ScaleKind;
  value: (model: ModelIntelligenceModel) => number | null;
  format: (value: number) => string;
}

export const formatUsd = (value: number): string => {
  if (value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 100) return `$${Math.round(value).toLocaleString('en-US')}`;
  if (abs >= 1) return `$${trimZeros(value.toFixed(2))}`;
  if (abs >= 0.01) return `$${trimZeros(value.toFixed(3))}`;
  return `$${trimZeros(value.toPrecision(2))}`;
};

export const formatPlain = (value: number, digits = 1): string => {
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString('en-US');
  return trimZeros(value.toFixed(digits));
};

/** Benchmark index values always show one decimal (e.g. 58.0). */
export const formatIndex = (value: number): string => value.toFixed(1);

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export const Y_AXES: ReadonlyArray<AxisDefinition<YAxisKey>> = [
  {
    key: 'intelligence',
    scale: 'linear',
    value: (m) => m.intelligenceIndex,
    format: formatIndex,
  },
  { key: 'coding', scale: 'linear', value: (m) => m.codingIndex, format: formatIndex },
  { key: 'agentic', scale: 'linear', value: (m) => m.agenticIndex, format: formatIndex },
];

export const X_AXES: ReadonlyArray<AxisDefinition<XAxisKey> & { hint: AxisHint }> = [
  {
    key: 'price_blended',
    scale: 'log',
    hint: 'upper_left',
    value: (m) => m.priceBlended,
    format: formatUsd,
  },
  {
    key: 'index_cost',
    scale: 'log',
    hint: 'upper_left',
    value: (m) => m.indexCost,
    format: formatUsd,
  },
  {
    key: 'speed',
    scale: 'linear',
    hint: 'upper_right',
    value: (m) => m.outputTokensPerSecond,
    format: (v) => formatPlain(v, 0),
  },
  {
    key: 'ttft',
    scale: 'linear',
    hint: 'upper_left',
    value: (m) => m.timeToFirstToken,
    format: (v) => `${formatPlain(v, 2)}s`,
  },
];

export const getYAxis = (key: YAxisKey) => Y_AXES.find((axis) => axis.key === key) ?? Y_AXES[0];
export const getXAxis = (key: XAxisKey) => X_AXES.find((axis) => axis.key === key) ?? X_AXES[0];

export interface Scale {
  kind: ScaleKind;
  domain: [number, number];
  ticks: number[];
  /** 0..1 position within the domain, or null when the value cannot be plotted. */
  position: (value: number | null | undefined) => number | null;
}

function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  const fraction = rawStep / base;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/** Linear scale starting at zero (or the minimum when negative), with "nice" ticks. */
export function createLinearScale(values: ReadonlyArray<number>, tickCount = 5): Scale {
  const finite = values.filter((v) => Number.isFinite(v));
  const rawMin = finite.length ? Math.min(0, ...finite) : 0;
  const rawMax = finite.length ? Math.max(...finite) : 1;
  const span = rawMax - rawMin || Math.abs(rawMax) || 1;
  const step = niceStep(span / Math.max(1, tickCount));
  const min = Math.floor(rawMin / step) * step;
  let max = Math.ceil(rawMax / step) * step;
  if (max <= min) max = min + step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return {
    kind: 'linear',
    domain: [min, max],
    ticks,
    position: (value) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      return (value - min) / (max - min);
    },
  };
}

/**
 * Log10 scale snapped outward to whole decades. Non-positive values are not
 * plottable (position → null). Narrow ranges (≤ 2 decades) also tick at 2× and 5×.
 */
export function createLogScale(values: ReadonlyArray<number>): Scale {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  let lowExp = positive.length ? Math.floor(Math.log10(Math.min(...positive))) : 0;
  let highExp = positive.length ? Math.ceil(Math.log10(Math.max(...positive))) : 1;
  if (highExp <= lowExp) highExp = lowExp + 1;
  // Guard against floating error turning 10^k into 10^(k-1).
  lowExp = Math.round(lowExp);
  highExp = Math.round(highExp);
  const min = 10 ** lowExp;
  const max = 10 ** highExp;
  const decades = highExp - lowExp;
  const multipliers = decades <= 2 ? [1, 2, 5] : [1];
  const ticks: number[] = [];
  for (let exp = lowExp; exp <= highExp; exp += 1) {
    multipliers.forEach((mult) => {
      const tick = Number((mult * 10 ** exp).toPrecision(12));
      if (tick >= min && tick <= max) ticks.push(tick);
    });
  }
  const logMin = Math.log10(min);
  const logSpan = Math.log10(max) - logMin;
  return {
    kind: 'log',
    domain: [min, max],
    ticks,
    position: (value) => {
      if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
        return null;
      }
      return (Math.log10(value) - logMin) / logSpan;
    },
  };
}

export function createScale(kind: ScaleKind, values: ReadonlyArray<number>): Scale {
  return kind === 'log' ? createLogScale(values) : createLinearScale(values);
}

export interface ChartPoint {
  model: ModelIntelligenceModel;
  x: number;
  y: number;
}

/** Points with both coordinates present (and positive on a log X axis). */
export function buildChartPoints(
  models: ReadonlyArray<ModelIntelligenceModel>,
  xAxis: XAxisKey,
  yAxis: YAxisKey
): ChartPoint[] {
  const xDef = getXAxis(xAxis);
  const yDef = getYAxis(yAxis);
  const points: ChartPoint[] = [];
  models.forEach((model) => {
    const x = xDef.value(model);
    const y = yDef.value(model);
    if (x === null || y === null) return;
    if (xDef.scale === 'log' && x <= 0) return;
    points.push({ model, x, y });
  });
  return points;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortKey =
  | 'name'
  | 'creator'
  | 'intelligence'
  | 'coding'
  | 'agentic'
  | 'price_blended'
  | 'price_input'
  | 'price_output'
  | 'speed'
  | 'ttft'
  | 'context'
  | 'released';
export type SortDirection = 'asc' | 'desc';

const SORT_VALUE: Record<SortKey, (m: ModelIntelligenceModel) => number | string | null> = {
  name: (m) => m.name.toLowerCase() || null,
  creator: (m) => m.creator.name.toLowerCase() || null,
  intelligence: (m) => m.intelligenceIndex,
  coding: (m) => m.codingIndex,
  agentic: (m) => m.agenticIndex,
  price_blended: (m) => m.priceBlended,
  price_input: (m) => m.priceInput,
  price_output: (m) => m.priceOutput,
  speed: (m) => m.outputTokensPerSecond,
  ttft: (m) => m.timeToFirstToken,
  context: (m) => m.contextWindow,
  released: (m) => {
    if (!m.releaseDate) return null;
    const time = Date.parse(m.releaseDate);
    return Number.isFinite(time) ? time : null;
  },
};

/** Text columns read naturally A→Z first; numeric columns start high→low. */
export const defaultSortDirection = (key: SortKey): SortDirection =>
  key === 'name' || key === 'creator' ? 'asc' : 'desc';

/** Stable sort; nulls always sink to the bottom regardless of direction; ties by name. */
export function sortModels(
  models: ReadonlyArray<ModelIntelligenceModel>,
  key: SortKey,
  direction: SortDirection
): ModelIntelligenceModel[] {
  const read = SORT_VALUE[key];
  const sign = direction === 'asc' ? 1 : -1;
  return models
    .map((model, index) => ({ model, index, value: read(model) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const diff =
        typeof a.value === 'string' || typeof b.value === 'string'
          ? String(a.value).localeCompare(String(b.value))
          : a.value - b.value;
      if (diff !== 0) return diff * sign;
      const byName = a.model.name.localeCompare(b.model.name);
      return byName !== 0 ? byName : a.index - b.index;
    })
    .map((entry) => entry.model);
}

// ---------------------------------------------------------------------------
// Creator palette and filtering
// ---------------------------------------------------------------------------

export const CREATOR_PALETTE_SIZE = 8;
export const UNKNOWN_CREATOR = '';

export interface CreatorSummary {
  name: string;
  count: number;
  /** Palette slot 0..CREATOR_PALETTE_SIZE-1, or -1 for the grey "other" colour. */
  colorIndex: number;
}

/**
 * Creators ordered by model count (desc, then name A→Z). The top
 * CREATOR_PALETTE_SIZE get a fixed palette slot in that order; the rest share
 * grey. Assignment depends only on the full model list, so filtering never
 * repaints a creator.
 */
export function summarizeCreators(
  models: ReadonlyArray<Pick<ModelIntelligenceModel, 'creator'>>,
  paletteSize = CREATOR_PALETTE_SIZE
): CreatorSummary[] {
  const counts = new Map<string, number>();
  models.forEach((model) => {
    const name = model.creator.name || UNKNOWN_CREATOR;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => {
      // Unknown creator always ranks last so it never takes a palette slot.
      if (a[0] === UNKNOWN_CREATOR) return 1;
      if (b[0] === UNKNOWN_CREATOR) return -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([name, count], index) => ({
      name,
      count,
      colorIndex: name !== UNKNOWN_CREATOR && index < paletteSize ? index : -1,
    }));
}

export interface ModelFilter {
  search: string;
  hiddenCreators: ReadonlySet<string>;
  onlyInProxy: boolean;
  inProxy: (model: ModelIntelligenceModel) => boolean;
}

export function filterModels(
  models: ReadonlyArray<ModelIntelligenceModel>,
  filter: ModelFilter
): ModelIntelligenceModel[] {
  const term = filter.search.trim().toLowerCase();
  return models.filter((model) => {
    if (filter.hiddenCreators.has(model.creator.name || UNKNOWN_CREATOR)) return false;
    if (filter.onlyInProxy && !filter.inProxy(model)) return false;
    if (!term) return true;
    return [model.name, model.slug, model.creator.name, model.openrouterId ?? ''].some((value) =>
      value.toLowerCase().includes(term)
    );
  });
}
