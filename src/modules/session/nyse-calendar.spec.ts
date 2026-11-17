import { describe, expect, it, vi } from 'vitest';
import { nextOpeningBell } from './nyse-calendar';
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
