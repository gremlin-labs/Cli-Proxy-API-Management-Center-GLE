/**
 * Pure helpers for the quota ledger: remaining percentages, per-provider window
 * totals, masked credential names and reset labels.
 */

export type LedgerTone = 'good' | 'warn' | 'low' | 'unknown';

export interface LedgerWindow {
  id: string;
  label: string;
  /** Remaining allowance in percent (0-100), or null when unknown. */
  remaining: number | null;
  /** Epoch milliseconds of the next reset, or null when none is pending. */
  resetAt: number | null;
}

export interface LedgerWindowTotal {
  id: string;
  label: string;
  /** Sum of remaining percentages across credentials that report this window. */
  total: number;
  /** 100 × the number of credentials that report this window. */
  max: number;
  /** Earliest pending reset among those credentials. */
  earliestReset: number | null;
  /** One entry per credential, in input order; null when it does not report the window. */
  segments: Array<number | null>;
}

const HIGH_THRESHOLD = 70;
const MEDIUM_THRESHOLD = 30;

export function remainingFromUsed(usedPercent: number | null | undefined): number | null {
  if (usedPercent === null || usedPercent === undefined || !Number.isFinite(usedPercent)) {
    return null;
  }
  const used = Math.max(0, Math.min(100, usedPercent));
  return 100 - used;
}

export function remainingTone(remaining: number | null): LedgerTone {
  if (remaining === null) return 'unknown';
  if (remaining >= HIGH_THRESHOLD) return 'good';
  if (remaining >= MEDIUM_THRESHOLD) return 'warn';
  return 'low';
}

/**
 * Totals each window across credentials. Windows are ordered most constrained
 * first (lowest share of remaining allowance), so the first entry is the one to
 * watch.
 */
export function totalWindows(credentials: LedgerWindow[][], now = Date.now()): LedgerWindowTotal[] {
  const order: string[] = [];
  const byId = new Map<string, LedgerWindowTotal>();
  credentials.forEach((windows, index) => {
    windows.forEach((window) => {
      let entry = byId.get(window.id);
      if (!entry) {
        entry = {
          id: window.id,
          label: window.label,
          total: 0,
          max: 0,
          earliestReset: null,
          segments: credentials.map(() => null),
        };
        byId.set(window.id, entry);
        order.push(window.id);
      }
      if (window.remaining !== null) {
        entry.total += window.remaining;
        entry.max += 100;
        entry.segments[index] = window.remaining;
      }
      if (window.resetAt !== null && window.resetAt > now) {
        if (entry.earliestReset === null || window.resetAt < entry.earliestReset) {
          entry.earliestReset = window.resetAt;
        }
      }
    });
  });
  const ratio = (entry: LedgerWindowTotal) => (entry.max > 0 ? entry.total / entry.max : 2);
  return order
    .map((id) => byId.get(id) as LedgerWindowTotal)
    .sort((a, b) => ratio(a) - ratio(b) || order.indexOf(a.id) - order.indexOf(b.id));
}

const MASK = '•••';

/**
 * Masks the account part of a credential file name, e.g.
 * `claude-2c5f10ca-person@example.com.json` → `claude-2•••@e•••.com.json`.
 * Names without an email are returned unchanged.
 */
export function maskCredentialName(name: string): string {
  const at = name.indexOf('@');
  if (at <= 0) return name;
  const dash = name.indexOf('-');
  const localStart = dash >= 0 && dash < at ? dash + 1 : 0;
  const local = name.slice(localStart, at);
  const rest = name.slice(at + 1);
  const dot = rest.indexOf('.');
  if (!local || dot <= 0) return name;
  const domainHead = rest.slice(0, dot);
  const domainTail = rest.slice(dot);
  return `${name.slice(0, localStart)}${local[0]}${MASK}@${domainHead[0]}${MASK}${domainTail}`;
}

/** Short absolute reset time such as `09/12, 23:00`. */
export function formatResetClock(epochMs: number, locale?: string): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${day}, ${time}`;
}
