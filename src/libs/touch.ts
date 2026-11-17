/**
 * Returns true when the closed segment between prevCents (or cents if undefined)
 * and cents overlaps the closed cell band [lowerCents, upperCents].
 */
export function segmentTouchesBand(
    prevCents: number | undefined,
    cents: number,
    lowerCents: number,
    upperCents: number,
): boolean {
    const anchor = prevCents ?? cents;
    const lo = Math.min(anchor, cents);
    const hi = Math.max(anchor, cents);
    return lo <= upperCents && hi >= lowerCents;
}
