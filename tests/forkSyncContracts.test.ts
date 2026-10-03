import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { authFilesApi } from '../src/services/api/authFiles';
import { mergeDiscoveredModels } from '../src/features/providers/modelEntries';
import { normalizeApiBase, computeApiUrl } from '../src/utils/connection';
import { KIMI_CONFIG } from '../src/components/quota/quotaConfigs';
import { buildKimiQuotaRows } from '../src/utils/quota/builders';
import type { AuthFileItem } from '../src/types';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('fork upstream sync contracts', () => {
  test('manual refresh targets credential identity and discards token-bearing response', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      auth: { access_token: 'fixture-only' },
    });
    restore = () => post.mockRestore();
    expect(await authFilesApi.requestManualRefresh('account.json', ' auth-1 ')).toBeUndefined();
    expect(post).toHaveBeenCalledWith('/auth-files/refresh', {
      name: 'account.json',
      auth_index: 'auth-1',
    });
  });
  test('status targets auth index without changing the v0 endpoint', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    restore = () => patch.mockRestore();
    await authFilesApi.setStatus('account.json', false, ' auth-1 ');
    expect(patch).toHaveBeenCalledWith('/auth-files/status', {
      name: 'account.json',
      disabled: false,
      auth_index: 'auth-1',
    });
  });
  test('model discovery preserves distinct existing aliases and adds each new name once', () => {
    const existing = [
      { name: 'model', alias: 'private/model' },
      { name: 'model', alias: 'public/model' },
    ];
    const merged = mergeDiscoveredModels(existing, [
      { name: 'model' },
      { name: 'new' },
      { name: 'new' },
    ]);
    expect(merged.slice(0, 2)).toEqual(existing);
    expect(merged).toHaveLength(3);
    expect(merged[2].name).toBe('new');
  });
  test('accepts both management URL suffixes and keeps custom v0 transport', () => {
    for (const version of ['v0', 'v8']) {
      const url = `https://proxy.invalid/gateway/${version}/management///`;
      expect(normalizeApiBase(url)).toBe('https://proxy.invalid/gateway');
      expect(computeApiUrl(url)).toBe('https://proxy.invalid/gateway/v0/management');
    }
  });
  test('connection revision detects ABA server switches but ignores equivalent config', () => {
    const first = { apiBase: 'https://first.invalid', managementKey: 'fixture' };
    apiClient.setConfig(first);
    const initial = apiClient.getConnectionRevision();
    apiClient.setConfig(first);
    expect(apiClient.getConnectionRevision()).toBe(initial);
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture' });
    apiClient.setConfig(first);
    expect(apiClient.getConnectionRevision()).toBe(initial + 2);
    apiClient.setConfig({ apiBase: '', managementKey: '' });
  });
  test('Kimi International is included and monthly ratio appends after existing windows', () => {
    expect(
      KIMI_CONFIG.filterFn({ name: 'kimi-ai.json', provider: 'kimi-ai' } as AuthFileItem)
    ).toBe(true);
    const rows = buildKimiQuotaRows({
      usage: { used: 5, limit: 100 },
      usages: { limit_month_total: { used_ratio: '0.25', reset_time: '2099-01-01T00:00:00Z' } },
    });
    expect(rows.map((row) => row.id)).toEqual(['summary', 'monthly']);
    expect(rows[1]).toMatchObject({ used: 25, limit: 100, labelKey: 'kimi_quota.monthly_limit' });
  });
});
