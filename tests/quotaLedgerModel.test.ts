import { describe, expect, test } from 'bun:test';
import {
  formatResetClock,
  maskCredentialName,
  remainingFromUsed,
  remainingTone,
  totalWindows,
} from '../src/components/quota/quotaLedgerModel';

describe('quota ledger model', () => {
  test('remaining is the unused share, clamped', () => {
    expect(remainingFromUsed(42)).toBe(58);
    expect(remainingFromUsed(0)).toBe(100);
    expect(remainingFromUsed(130)).toBe(0);
    expect(remainingFromUsed(null)).toBeNull();
  });

  test('tones follow the quota thresholds', () => {
    expect(remainingTone(100)).toBe('good');
    expect(remainingTone(70)).toBe('good');
    expect(remainingTone(58)).toBe('warn');
    expect(remainingTone(12)).toBe('low');
    expect(remainingTone(null)).toBe('unknown');
  });

  test('totals windows across credentials, most constrained first', () => {
    const now = 1_000;
    const totals = totalWindows(
      [
        [
          { id: 'weekly', label: '7-day limit', remaining: 79, resetAt: 9_000 },
          { id: 'opus', label: '7-day Opus', remaining: 58, resetAt: 5_000 },
        ],
        [
          { id: 'weekly', label: '7-day limit', remaining: 100, resetAt: 4_000 },
          { id: 'opus', label: '7-day Opus', remaining: null, resetAt: null },
        ],
        [{ id: 'weekly', label: '7-day limit', remaining: 75, resetAt: 500 }],
      ],
      now
    );
    expect(totals.map((entry) => entry.id)).toEqual(['opus', 'weekly']);
    const [opus, weekly] = totals;
    expect(opus.total).toBe(58);
    expect(opus.max).toBe(100);
    expect(opus.segments).toEqual([58, null, null]);
    expect(weekly.total).toBe(254);
    expect(weekly.max).toBe(300);
    // The 500 ms reset is already in the past, so the earliest pending one wins.
    expect(weekly.earliestReset).toBe(4_000);
  });

  test('masks the account part of credential names', () => {
    expect(maskCredentialName('claude-2c5f10ca-person@example.com.json')).toBe(
      'claude-2•••@e•••.com.json'
    );
    expect(maskCredentialName('codex-me@gremlin.email-plus.json')).toBe(
      'codex-m•••@g•••.email-plus.json'
    );
    expect(maskCredentialName('claude-api-key.json')).toBe('claude-api-key.json');
  });

  test('formats a short reset clock', () => {
    const label = formatResetClock(new Date(2026, 8, 12, 23, 0).getTime(), 'en-US');
    expect(label).toBe('09/12, 23:00');
  });
});
