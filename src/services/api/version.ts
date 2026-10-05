/**
 * 版本相关 API
 */

import { apiClient } from './client';

export const versionApi = {
  async installLatestManagement(): Promise<void> {
    await apiClient.post('/management-html/install');
  },

  // The backend reports the newest release of the API it tracks.
  checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version'),
};
