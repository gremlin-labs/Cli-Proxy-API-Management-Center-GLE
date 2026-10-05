import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { hasResettableCooldown } from '../src/features/authFiles/cooldowns';
import type { AuthFileItem } from '../src/types/authFile';

const source = readFileSync('src/features/authFiles/hooks/useAuthFilesData.ts', 'utf8');

const cooling = (name: string, authIndex: string): AuthFileItem => ({
  name,
  authIndex,
  cooldownSnapshot: {
    receivedAtMs: 0,
    records: [
      {
        scope: 'credential',
        reason: 'quota',
        retryAt: '2026-10-04T00:01:00Z',
        remainingSeconds: 60,
      },
    ],
  },
});

function harness(files: AuthFileItem[], failing: Set<string> = new Set()) {
  let revision = 1;
  let confirmation: { message: string; onConfirm: () => Promise<void> } | undefined;
  let state = files;
  let loads = 0;
  const notifications: Array<[string, string]> = [];
  const calls: string[] = [];
  const env = {
    apiClient: { getConnectionRevision: () => revision },
    authFilesApi: {
      resetCooldown: async (authIndex: string) => {
        calls.push(authIndex);
        if (failing.has(authIndex)) throw new Error('boom');
        return {};
      },
    },
    hasResettableCooldown,
    files,
    cooldownResetPendingRef: { current: new Set<string>() },
    setCooldownResetting: () => {},
    setFiles: (update: (prev: AuthFileItem[]) => AuthFileItem[]) => {
      state = update(state);
    },
    showConfirmation: (options: { message: string; onConfirm: () => Promise<void> }) => {
      confirmation = options;
    },
    showNotification: (message: string, type: string) => {
      notifications.push([message, type]);
    },
    invalidateInFlightLoads: () => {},
    loadFiles: async () => {
      loads++;
    },
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    useCallback: (fn: unknown) => fn,
  };
  const block = source.slice(
    source.indexOf('  const batchCooldownReset = useCallback('),
    source.indexOf('  const handleStatusToggle = useCallback(')
  );
  const js = ts.transpileModule(`${block}\nreturn batchCooldownReset;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function(...Object.keys(env), js)(...Object.values(env)) as (
    names: string[]
  ) => void;
  return {
    run,
    confirm: () => confirmation?.onConfirm(),
    get confirmMessage() {
      return confirmation?.message;
    },
    switchConnection: () => {
      revision++;
    },
    calls,
    notifications,
    get files() {
      return state;
    },
    get loads() {
      return loads;
    },
  };
}

describe('batch cooldown reset', () => {
  test('targets only selected credentials with a resettable cooldown, after one confirmation', async () => {
    const files = [
      cooling('a.json', '1'),
      cooling('b.json', '2'),
      { name: 'idle.json', authIndex: '3', cooldownSnapshot: { receivedAtMs: 0, records: [] } },
      { name: 'unaddressable.json', cooldownSnapshot: cooling('x', '9').cooldownSnapshot },
    ];
    const h = harness(files);
    h.run(['a.json', 'idle.json', 'unaddressable.json', 'b.json']);
    expect(h.calls).toEqual([]);
    expect(h.confirmMessage).toContain('"count":2');

    await h.confirm();
    expect(h.calls).toEqual(['1', '2']);
    expect(h.files.find((file) => file.name === 'a.json')?.cooldownSnapshot?.records).toEqual([]);
    expect(h.notifications).toEqual([
      ['auth_files.batch_cooldown_reset_success:{"count":2}', 'success'],
    ]);
    expect(h.loads).toBe(1);
  });

  test('does nothing when no selected credential has a cooldown', () => {
    const h = harness([{ name: 'idle.json', authIndex: '3' }]);
    h.run(['idle.json']);
    expect(h.confirmMessage).toBeUndefined();
  });

  test('reports partial failure and only clears the cooldowns that were reset', async () => {
    const h = harness([cooling('a.json', '1'), cooling('b.json', '2')], new Set(['2']));
    h.run(['a.json', 'b.json']);
    await h.confirm();
    expect(h.files.find((file) => file.name === 'a.json')?.cooldownSnapshot?.records).toEqual([]);
    expect(h.files.find((file) => file.name === 'b.json')?.cooldownSnapshot?.records).toHaveLength(
      1
    );
    expect(h.notifications).toEqual([
      ['auth_files.batch_cooldown_reset_partial:{"success":1,"failed":1}', 'warning'],
    ]);
  });

  test('a confirmation from an old connection sends no request', async () => {
    const h = harness([cooling('a.json', '1')]);
    h.run(['a.json']);
    h.switchConnection();
    await h.confirm();
    expect(h.calls).toEqual([]);
  });
});
