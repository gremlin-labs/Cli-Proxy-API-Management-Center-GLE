import { describe, expect, test } from 'bun:test';
import {
  buildChartPoints,
  buildProxyModelIndex,
  createLinearScale,
  createLogScale,
  filterModels,
  formatUsd,
  isModelInProxy,
  normalizeModelId,
  parseModelIntelligenceResponse,
  sortModels,
  summarizeCreators,
} from '@/pages/modelIntelligence';
import type { ModelIntelligenceModel } from '@/types/modelIntelligence';

const model = (overrides: Partial<ModelIntelligenceModel> = {}): ModelIntelligenceModel => ({
  id: 'id',
  name: 'Model',
  slug: 'model',
  creator: { name: 'Acme', country: null },
  releaseDate: null,
  reasoning: false,
  openWeights: null,
  contextWindow: null,
  intelligenceIndex: null,
  codingIndex: null,
  agenticIndex: null,
  priceInput: null,
  priceOutput: null,
  priceBlended: null,
  indexCost: null,
  outputTokensPerSecond: null,
  timeToFirstToken: null,
  endToEndSeconds: null,
  openrouterId: null,
  ...overrides,
});

describe('normalizeModelId', () => {
  test('lowercases and strips compact and dashed date suffixes', () => {
    expect(normalizeModelId('Claude-Sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(normalizeModelId('claude-opus-4-20250514')).toBe('claude-opus-4');
  });

  test("replaces '.' and '_' with '-'", () => {
    expect(normalizeModelId('gemini-2.5-pro')).toBe('gemini-2-5-pro');
    expect(normalizeModelId('gpt_5.1_codex')).toBe('gpt-5-1-codex');
  });

  test('drops provider prefixes and OpenRouter variant suffixes', () => {
    expect(normalizeModelId('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('meta-llama/llama-3.3-70b-instruct:free')).toBe(
      'llama-3-3-70b-instruct'
    );
  });

  test('keeps short numeric suffixes and token order', () => {
    expect(normalizeModelId('qwen3-235b-a22b-2507')).toBe('qwen3-235b-a22b-2507');
    expect(normalizeModelId('claude-4-5-sonnet')).not.toBe(normalizeModelId('claude-sonnet-4-5'));
  });

  test('empty input', () => {
    expect(normalizeModelId('')).toBe('');
    expect(normalizeModelId(null)).toBe('');
  });
});

describe('proxy availability', () => {
  const index = buildProxyModelIndex([
    { name: 'claude-sonnet-4-5-20250929' },
    { name: 'gpt-5.1', alias: 'my-gpt' },
  ]);

  test('matches by slug', () => {
    expect(isModelInProxy(model({ slug: 'gpt-5-1' }), index)).toBe(true);
  });

  test('matches by the model part of openrouter_id', () => {
    const m = model({ slug: 'claude-4-5-sonnet', openrouterId: 'anthropic/claude-sonnet-4.5' });
    expect(isModelInProxy(m, index)).toBe(true);
  });

  test('matches aliases and rejects unknown models', () => {
    expect(isModelInProxy(model({ slug: 'my-gpt' }), index)).toBe(true);
    expect(isModelInProxy(model({ slug: 'claude-4-5-sonnet' }), index)).toBe(false);
    expect(isModelInProxy(model({ slug: 'gpt-5-1' }), new Set())).toBe(false);
  });
});

describe('scales', () => {
  test('linear scale starts at zero with nice ticks', () => {
    const scale = createLinearScale([12, 47, 73]);
    expect(scale.domain).toEqual([0, 80]);
    expect(scale.ticks).toEqual([0, 20, 40, 60, 80]);
    expect(scale.position(40)).toBe(0.5);
    expect(scale.position(null)).toBeNull();
  });

  test('linear scale with no values falls back to a unit domain', () => {
    const scale = createLinearScale([]);
    expect(scale.domain[0]).toBe(0);
    expect(scale.domain[1]).toBeGreaterThan(0);
  });

  test('log scale snaps to decades and positions logarithmically', () => {
    const scale = createLogScale([0.15, 3, 60]);
    expect(scale.domain).toEqual([0.1, 100]);
    expect(scale.ticks).toEqual([0.1, 1, 10, 100]);
    expect(scale.position(1)).toBeCloseTo(1 / 3, 10);
    expect(scale.position(10)).toBeCloseTo(2 / 3, 10);
    expect(scale.position(0)).toBeNull();
    expect(scale.position(-1)).toBeNull();
  });

  test('narrow log scale adds 2x and 5x ticks', () => {
    const scale = createLogScale([2, 30]);
    expect(scale.domain).toEqual([1, 100]);
    expect(scale.ticks).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  test('single-value log scale spans one decade', () => {
    const scale = createLogScale([1]);
    expect(scale.domain).toEqual([1, 10]);
  });

  test('chart points skip null and non-positive log values', () => {
    const models = [
      model({ id: 'a', priceBlended: 1, intelligenceIndex: 50 }),
      model({ id: 'b', priceBlended: null, intelligenceIndex: 50 }),
      model({ id: 'c', priceBlended: 0, intelligenceIndex: 50 }),
      model({ id: 'd', priceBlended: 2, intelligenceIndex: null }),
    ];
    expect(
      buildChartPoints(models, 'price_blended', 'intelligence').map((p) => p.model.id)
    ).toEqual(['a']);
    const speed = [model({ id: 'e', outputTokensPerSecond: 0, codingIndex: 10 })];
    expect(buildChartPoints(speed, 'speed', 'coding')).toHaveLength(1);
  });
});

describe('sortModels', () => {
  const models = [
    model({ id: 'a', name: 'Alpha', intelligenceIndex: 40 }),
    model({ id: 'b', name: 'Bravo', intelligenceIndex: null }),
    model({ id: 'c', name: 'Charlie', intelligenceIndex: 60 }),
    model({ id: 'd', name: 'Delta', intelligenceIndex: 40 }),
  ];

  test('desc with nulls last and name tie-break', () => {
    expect(sortModels(models, 'intelligence', 'desc').map((m) => m.id)).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });

  test('asc keeps nulls last', () => {
    expect(sortModels(models, 'intelligence', 'asc').map((m) => m.id)).toEqual([
      'a',
      'd',
      'c',
      'b',
    ]);
  });

  test('text and date columns', () => {
    expect(sortModels(models, 'name', 'desc').map((m) => m.id)).toEqual(['d', 'c', 'b', 'a']);
    const dated = [
      model({ id: 'x', releaseDate: '2025-01-01' }),
      model({ id: 'y', releaseDate: 'not a date' }),
      model({ id: 'z', releaseDate: '2025-06-01' }),
    ];
    expect(sortModels(dated, 'released', 'desc').map((m) => m.id)).toEqual(['z', 'x', 'y']);
  });
});

describe('summarizeCreators', () => {
  test('top creators by count get palette slots, the rest are grey', () => {
    const models = [
      ...['A', 'A', 'A', 'B', 'B', 'C', 'D'].map((name) =>
        model({ creator: { name, country: null } })
      ),
      model({ creator: { name: '', country: null } }),
    ];
    const summary = summarizeCreators(models, 2);
    expect(summary.map((c) => [c.name, c.count, c.colorIndex])).toEqual([
      ['A', 3, 0],
      ['B', 2, 1],
      ['C', 1, -1],
      ['D', 1, -1],
      ['', 1, -1],
    ]);
  });

  test('ties break alphabetically and unknown never takes a slot', () => {
    const models = ['Zeta', 'Beta', ''].map((name) => model({ creator: { name, country: null } }));
    expect(summarizeCreators(models).map((c) => [c.name, c.colorIndex])).toEqual([
      ['Beta', 0],
      ['Zeta', 1],
      ['', -1],
    ]);
  });
});

describe('filterModels', () => {
  const models = [
    model({ id: 'a', name: 'GPT-5', creator: { name: 'OpenAI', country: null } }),
    model({ id: 'b', name: 'Claude', creator: { name: 'Anthropic', country: null } }),
  ];
  test('search, hidden creators and proxy toggle combine', () => {
    const base = {
      search: '',
      hiddenCreators: new Set<string>(),
      onlyInProxy: false,
      inProxy: () => true,
    };
    expect(filterModels(models, { ...base, search: 'anthro' }).map((m) => m.id)).toEqual(['b']);
    expect(
      filterModels(models, { ...base, hiddenCreators: new Set(['OpenAI']) }).map((m) => m.id)
    ).toEqual(['b']);
    expect(
      filterModels(models, { ...base, onlyInProxy: true, inProxy: (m) => m.id === 'a' }).map(
        (m) => m.id
      )
    ).toEqual(['a']);
  });
});

describe('parseModelIntelligenceResponse', () => {
  test('tolerates missing and malformed fields', () => {
    const data = parseModelIntelligenceResponse({
      configured: true,
      key_source: 'env',
      tier: 'free',
      intelligence_index_version: 3,
      fetched_at: '2026-10-05T00:00:00Z',
      models: [
        {
          id: 'x',
          name: 'X',
          slug: 'x',
          creator: { name: 'Acme' },
          intelligence_index: '61.2',
          price_blended: null,
          output_tokens_per_second: 'fast',
        },
        'junk',
        { slug: 'only-slug' },
      ],
    });
    expect(data.configured).toBe(true);
    expect(data.keySource).toBe('env');
    expect(data.intelligenceIndexVersion).toBe('3');
    expect(data.source.name).toBe('Artificial Analysis');
    expect(data.models).toHaveLength(2);
    expect(data.models[0].intelligenceIndex).toBe(61.2);
    expect(data.models[0].priceBlended).toBeNull();
    expect(data.models[0].outputTokensPerSecond).toBeNull();
    expect(data.models[0].creator.country).toBeNull();
    expect(data.models[1].id).toBe('only-slug');
    expect(data.models[1].name).toBe('only-slug');
  });

  test('non-object payload yields an unconfigured empty result', () => {
    const data = parseModelIntelligenceResponse(null);
    expect(data.configured).toBe(false);
    expect(data.models).toEqual([]);
    expect(data.keySource).toBe('');
  });
});

test('formatUsd', () => {
  expect(formatUsd(0)).toBe('$0');
  expect(formatUsd(1.5)).toBe('$1.5');
  expect(formatUsd(0.075)).toBe('$0.075');
  expect(formatUsd(1234)).toBe('$1,234');
  expect(formatUsd(0.001)).toBe('$0.001');
});
