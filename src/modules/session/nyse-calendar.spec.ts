import { describe, expect, it, vi } from 'vitest';
import {
  isEarlyCloseDay,
  isUsRegularSession,
  nextOpeningBell,
} from './nyse-calendar';
describe('Opening Bell', () => {
  it('skips Thanksgiving', () =>
    expect(
      nextOpeningBell(new Date('2026-11-25T20:00:00Z')).startsAt.toISOString(),
    ).toBe('2026-11-27T14:30:00.000Z'));
  it('returns the current bell while live', () =>
    expect(
      nextOpeningBell(new Date('2026-11-23T14:40:00Z')).endsAt.toISOString(),
    ).toBe('2026-11-23T15:00:00.000Z'));
  it('uses EST in November', () =>
    expect(
      nextOpeningBell(new Date('2026-11-23T13:00:00Z')).startsAt.toISOString(),
    ).toBe('2026-11-23T14:30:00.000Z'));
});

describe('NYSE regular session and early closes', () => {
  it('closes at 13:00 ET on 2026-11-27 and 2026-12-24', () => {
    expect(isEarlyCloseDay('2026-11-27')).toBe(true);
    expect(isEarlyCloseDay('2026-12-24')).toBe(true);
    expect(isEarlyCloseDay('2026-11-17')).toBe(false);

    // 2026-11-27 EST (UTC-5): 12:59:59 ET = 17:59:59Z, 13:00:00 ET = 18:00:00Z
    expect(isUsRegularSession(new Date('2026-11-27T14:30:00Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-11-27T17:59:59Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-11-27T18:00:00Z'))).toBe(false);
    expect(isUsRegularSession(new Date('2026-11-27T20:00:00Z'))).toBe(false);

    // 2026-12-24 EST (UTC-5): 12:59:59 ET = 17:59:59Z, 13:00:00 ET = 18:00:00Z
    expect(isUsRegularSession(new Date('2026-12-24T14:30:00Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-12-24T17:59:59Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-12-24T18:00:00Z'))).toBe(false);
  });

  it('keeps normal trading days open until 16:00 ET and excludes holidays and weekends', () => {
    expect(isUsRegularSession(new Date('2026-11-17T18:00:00Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-11-17T20:59:59Z'))).toBe(true);
    expect(isUsRegularSession(new Date('2026-11-17T21:00:00Z'))).toBe(false);
    expect(isUsRegularSession(new Date('2026-11-26T15:00:00Z'))).toBe(false);
    expect(isUsRegularSession(new Date('2026-11-21T15:00:00Z'))).toBe(false);
  });
});

it('marks the session live only until the close', async () => {
  vi.useFakeTimers();
  try {
    const { SessionController } = await import('./session.controller');
    vi.setSystemTime(new Date('2026-11-23T14:40:00Z'));
    expect(new SessionController().next().isLive).toBe(true);
    vi.setSystemTime(new Date('2026-11-23T15:00:00Z'));
    expect(new SessionController().next().isLive).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
