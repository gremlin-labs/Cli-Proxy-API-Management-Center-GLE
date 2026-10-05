/**
 * Model Intelligence (management API): Artificial Analysis benchmark and pricing
 * data proxied and cached by the backend. The Artificial Analysis key is stored
 * server-side and never returned.
 */

import { apiClient } from './client';
import { parseModelIntelligenceResponse } from '@/pages/modelIntelligence';
import type {
  ModelIntelligenceConfigUpdate,
  ModelIntelligenceData,
} from '@/types/modelIntelligence';

export const modelIntelligenceApi = {
  async get(refresh = false): Promise<ModelIntelligenceData> {
    const data = await apiClient.get<unknown>('/model-intelligence', {
      params: refresh ? { refresh: 1 } : undefined,
    });
    return parseModelIntelligenceResponse(data);
  },

  /** Save (or clear, with an empty key) the Artificial Analysis API key. */
  async saveConfig(update: ModelIntelligenceConfigUpdate): Promise<void> {
    await apiClient.put('/model-intelligence/config', update);
  },
};
