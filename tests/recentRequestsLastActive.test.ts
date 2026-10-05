import { describe, expect, test } from 'bun:test';
import { lastActiveBlockAgeMs, type StatusBarData } from '../src/utils/recentRequests';

const BLOCK_MS = 10 * 60 * 1000;
const data = (blocks: StatusBarData['blocks']): StatusBarData => ({
  blocks,
  blockDetails: [],
  successRate: 0,
  totalSuccess: 0,
  totalFailure: 0,
});

describe('lastActiveBlockAgeMs', () => {
  test('is null when the window has no requests', () => {
    expect(lastActiveBlockAgeMs(data(['idle', 'idle', 'idle']))).toBeNull();
  });

  test('is 0 for activity in the current bucket', () => {
    expect(lastActiveBlockAgeMs(data(['idle', 'failure', 'success']))).toBe(0);
  });

  test('counts whole buckets back to the newest active one', () => {
    expect(lastActiveBlockAgeMs(data(['mixed', 'idle', 'idle', 'idle']))).toBe(3 * BLOCK_MS);
  });
});
