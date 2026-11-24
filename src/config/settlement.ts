export const DEFAULT_SETTLEMENT_VOID_GAP_MS = 3000;
export const SETTLEMENT_VOID_GAP_MS_TOKEN = 'SETTLEMENT_VOID_GAP_MS';

/**
 * Resolves SETTLEMENT_VOID_GAP_MS from an environment map, defaulting to 3000 ms.
 * Matches the Joi validation rule in src/config/index.ts (positive integer).
 */
export function resolveSettlementVoidGapMs(
  rawEnv: NodeJS.ProcessEnv = process.env,
): number {
  const raw = rawEnv.SETTLEMENT_VOID_GAP_MS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_SETTLEMENT_VOID_GAP_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Invalid SETTLEMENT_VOID_GAP_MS: expected positive integer, got "${raw}"`,
    );
  }
  return parsed;
}
