import { formatUnits, parseUnits } from 'ethers';
export function toLedgerAmount(base: bigint): number {
  const value = Number(formatUnits(base, 6));
  if (!Number.isFinite(value) || parseUnits(String(value), 6) !== base)
    throw new RangeError('Amount cannot be represented safely');
  return value;
}
export function toBaseUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0)
    throw new RangeError('Invalid amount');
  return parseUnits(String(amount), 6);
}
