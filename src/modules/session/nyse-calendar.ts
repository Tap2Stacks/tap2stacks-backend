import { DateTime } from 'luxon';
const ZONE = 'America/New_York';
const HOLIDAYS = new Set(['2026-11-26', '2026-12-25', '2027-01-01']);
export function isTradingDay(date: string): boolean {
  const day = DateTime.fromISO(date, { zone: ZONE });
  return (
    day.isValid &&
    day.toISODate() === date &&
    day.weekday <= 5 &&
    !HOLIDAYS.has(date)
  );
}
export function nextOpeningBell(now: Date): { startsAt: Date; endsAt: Date } {
  let day = DateTime.fromJSDate(now, { zone: ZONE }).startOf('day');
  if (!day.isValid) throw new RangeError('Invalid date');
  while (true) {
    const starts = day.set({ hour: 9, minute: 30 });
    const ends = day.set({ hour: 10, minute: 0 });
    if (isTradingDay(day.toISODate()!) && now.getTime() < ends.toMillis())
      return { startsAt: starts.toJSDate(), endsAt: ends.toJSDate() };
    day = day.plus({ days: 1 });
  }
}
