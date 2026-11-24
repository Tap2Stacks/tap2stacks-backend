import { resolveSettlementVoidGapMs } from 'src/config/settlement';
import { priceToCents } from 'src/libs/cell';
import { segmentTouchesBand } from 'src/libs/touch';
import { CanonicalSettledOrder, SettledTapStatus } from './types';

export interface PriceLogLine {
  ticker: string;
  tsMs: number;
  price: string;
}

function parseLines(
  input: readonly (PriceLogLine | string)[] | string,
): PriceLogLine[] {
  const rawLines =
    typeof input === 'string'
      ? input.split('\n').filter((line) => line.trim().length > 0)
      : input;

  return rawLines.map((item) =>
    typeof item === 'string' ? (JSON.parse(item) as PriceLogLine) : item,
  );
}

/**
 * Re-checks a settled tap's outcome against a batch's price-log lines using
 * the same segmentTouchesBand rule as OrderService.
 */
export function recomputeStatus(
  leaf: Pick<
    CanonicalSettledOrder,
    | 'ticker'
    | 'status'
    | 'cellTimeStart'
    | 'cellTimeEnd'
    | 'lowerPrice'
    | 'upperPrice'
  >,
  priceLogLines: readonly (PriceLogLine | string)[] | string,
  voidGapMs: number = resolveSettlementVoidGapMs(),
): SettledTapStatus {
  if (leaf.status === 'VOIDED') {
    return 'VOIDED';
  }

  const lowerCents = priceToCents(leaf.lowerPrice);
  const upperCents = priceToCents(leaf.upperPrice);
  const samples = parseLines(priceLogLines)
    .filter((line) => line.ticker === leaf.ticker)
    .sort((left, right) => left.tsMs - right.tsMs);

  let prevTs: number | undefined;
  let prevCents: number | undefined;

  for (const sample of samples) {
    const sampleCents = priceToCents(sample.price);
    const hasGap = prevTs !== undefined && sample.tsMs - prevTs > voidGapMs;
    const anchorCents = hasGap ? undefined : prevCents;

    if (
      sample.tsMs >= leaf.cellTimeStart &&
      sample.tsMs < leaf.cellTimeEnd &&
      segmentTouchesBand(anchorCents, sampleCents, lowerCents, upperCents)
    ) {
      return 'WON';
    }

    if (sample.tsMs >= leaf.cellTimeEnd) {
      return 'LOST';
    }

    prevTs = sample.tsMs;
    prevCents = sampleCents;
  }

  return 'LOST';
}
