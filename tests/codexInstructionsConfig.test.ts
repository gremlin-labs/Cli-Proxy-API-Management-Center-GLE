import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { configApi } from '../src/services/api/config';

const originalGet = apiClient.get;
const originalPut = apiClient.put;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
});

describe('Codex custom instructions config', () => {
  test('normalizes the response and ignores retired routing fields', async () => {
    apiClient.get = (async () => ({
      enabled: true,
      mode: 'append',
      content: 'Be concise.',
      file: '',
      models: [' gpt-5.5 ', ''],
      'oauth-only': false,
      'require-auth-allow': true,
      'reserve-marked-auths': true,
      'use-prefix-suffix': true,
      'request-markers': { prefixes: ['x/'], suffixes: [] },
    })) as typeof apiClient.get;

    expect(await configApi.getCodexInstructions()).toEqual({
      enabled: true,
      mode: 'append',
      content: 'Be concise.',
      file: '',
      models: ['gpt-5.5'],
      oauthOnly: false,
    });
  });

  test('tolerates an empty response', async () => {
    apiClient.get = (async () => ({})) as typeof apiClient.get;
    const config = await configApi.getCodexInstructions();
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('prepend');
    expect(config.models.length).toBeGreaterThan(0);
    expect(config.oauthOnly).toBe(true);
  });

  test('sends only the plain instruction fields', async () => {
    const calls: Array<{ url: string; data?: unknown }> = [];
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ url, data });
      return undefined;
    }) as typeof apiClient.put;

    await configApi.updateCodexInstructions({
      enabled: true,
      mode: 'replace',
      content: 'Hello',
      file: '/tmp/instructions.md',
      models: ['gpt-5*'],
      oauthOnly: true,
    });

    expect(calls).toEqual([
      {
        url: '/codex-instructions',
        data: {
          enabled: true,
          mode: 'replace',
          content: 'Hello',
          file: '/tmp/instructions.md',
          models: ['gpt-5*'],
          'oauth-only': true,
        },
      },
    ]);
  });
});
