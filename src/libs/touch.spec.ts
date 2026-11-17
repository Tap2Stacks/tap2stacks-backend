import { describe, expect, it } from 'vitest';
import { segmentTouchesBand } from './touch';

describe('segmentTouchesBand', () => {
  it('handles single point when prevCents is undefined', () => {
    expect(segmentTouchesBand(undefined, 15753, 15752, 15755)).toBe(true);
    expect(segmentTouchesBand(undefined, 15750, 15752, 15755)).toBe(false);
  });

  it('detects upward crossing even when neither endpoint is inside the band', () => {
    expect(segmentTouchesBand(15740, 15770, 15752, 15755)).toBe(true);
  });

  it('detects downward crossing even when neither endpoint is inside the band', () => {
    expect(segmentTouchesBand(15770, 15740, 15752, 15755)).toBe(true);
  });

  it('returns false when segment is completely outside the band', () => {
    expect(segmentTouchesBand(15740, 15750, 15752, 15755)).toBe(false);
    expect(segmentTouchesBand(15760, 15756, 15752, 15755)).toBe(false);
  });

  it('band edge counts for both adjacent cells (inclusive cents)', () => {
    expect(segmentTouchesBand(undefined, 15755, 15752, 15755)).toBe(true);
    expect(segmentTouchesBand(undefined, 15755, 15755, 15758)).toBe(true);
    expect(segmentTouchesBand(15740, 15752, 15752, 15755)).toBe(true);
    expect(segmentTouchesBand(15770, 15755, 15752, 15755)).toBe(true);
  });
});
