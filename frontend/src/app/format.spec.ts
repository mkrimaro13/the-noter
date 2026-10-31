import { describe, expect, it } from 'vitest';
import { blockCountLabel, relativeTime, resolveTimeFunctions, wordCount } from './format';

describe('relativeTime', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime();

  it('describes very recent edits', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 44_000, now)).toBe('just now');
  });

  it('describes minutes and hours', () => {
    expect(relativeTime(now - 60_000, now)).toBe('1m ago');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe(
      new Date(now - 2 * 3_600_000).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
  });

  it('uses a short date for older edits', () => {
    const older = new Date(2026, 0, 15, 9, 0, 0).getTime();
    expect(relativeTime(older, now)).toBe(
      new Date(older).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
  });

  it('includes the year for edits from another year', () => {
    const older = new Date(2025, 0, 15, 9, 0, 0).getTime();
    expect(relativeTime(older, now)).toBe(
      new Date(older).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    );
  });
});

describe('blockCountLabel', () => {
  it('pluralizes blocks', () => {
    expect(blockCountLabel(0)).toBe('0 blocks');
    expect(blockCountLabel(1)).toBe('1 block');
    expect(blockCountLabel(2)).toBe('2 blocks');
  });
});

describe('wordCount', () => {
  it('counts whitespace-separated words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('one')).toBe(1);
    expect(wordCount('one two\nthree')).toBe(3);
  });
});

describe('resolveTimeFunctions', () => {
  const now = new Date(2026, 9, 30, 14, 5, 9);

  it('expands now, today, and time', () => {
    expect(resolveTimeFunctions('today(YYYY-MM-DD)', now)).toBe('2026-10-30');
    expect(resolveTimeFunctions('time(HH:mm:ss)', now)).toBe('14:05:09');
    expect(resolveTimeFunctions('now(YYYY-MM-DD HH:mm)', now)).toBe('2026-10-30 14:05');
  });

  it('supports iso, unix, and millisecond modes', () => {
    expect(resolveTimeFunctions('now(iso)', now)).toBe(now.toISOString());
    expect(resolveTimeFunctions('now(unix)', now)).toBe(String(Math.floor(now.getTime() / 1000)));
    expect(resolveTimeFunctions('now(timestamp)', now)).toBe(String(now.getTime()));
    expect(resolveTimeFunctions('now(ms)', now)).toBe(String(now.getTime()));
  });

  it('supports date and time modes', () => {
    expect(resolveTimeFunctions('now(date)', now)).toBe(
      now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    );
    expect(resolveTimeFunctions('now(time)', now)).toBe(
      now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('strips quotes around custom patterns', () => {
    expect(resolveTimeFunctions(`now("YYYY/MM/DD")`, now)).toBe('2026/10/30');
    expect(resolveTimeFunctions(`today('ddd')`, now)).toBe('Fri');
  });

  it('replaces multiple functions in one value', () => {
    expect(resolveTimeFunctions('from today(YYYY) to now(YYYY)', now)).toBe('from 2026 to 2026');
  });

  it('leaves unrelated text alone', () => {
    expect(resolveTimeFunctions('no functions here', now)).toBe('no functions here');
  });
});
