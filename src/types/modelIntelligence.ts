/**
 * Model Intelligence: Artificial Analysis benchmark + pricing data served by the
 * management API (`GET /v0/management/model-intelligence`). Every numeric field
 * may be null when Artificial Analysis has no measurement for that model.
 */

export interface ModelIntelligenceCreator {
  name: string;
  country: string | null;
}

export interface ModelIntelligenceModel {
  id: string;
  name: string;
  slug: string;
  creator: ModelIntelligenceCreator;
  releaseDate: string | null;
  reasoning: boolean;
  openWeights: boolean | null;
  contextWindow: number | null;
  intelligenceIndex: number | null;
  codingIndex: number | null;
  agenticIndex: number | null;
  /** USD per 1M input tokens. */
  priceInput: number | null;
  /** USD per 1M output tokens. */
  priceOutput: number | null;
  /** USD per 1M tokens, blended input/output. */
  priceBlended: number | null;
  /** USD to run the full Intelligence Index evaluation. */
  indexCost: number | null;
  outputTokensPerSecond: number | null;
  /** Seconds. */
  timeToFirstToken: number | null;
  endToEndSeconds: number | null;
  openrouterId: string | null;
}

export type ModelIntelligenceKeySource = 'config' | 'env' | '';

export interface ModelIntelligenceData {
  configured: boolean;
  keySource: ModelIntelligenceKeySource;
  tier: string;
  intelligenceIndexVersion: string | null;
  fetchedAt: string | null;
  cached: boolean;
  warning: string;
  source: { name: string; url: string };
  models: ModelIntelligenceModel[];
}

export type ModelIntelligenceTier = 'free' | 'pro';

export interface ModelIntelligenceConfigUpdate {
  api_key: string;
  tier?: ModelIntelligenceTier;
}
