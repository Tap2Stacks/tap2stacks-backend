import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.POSTGRES_URL ??= 'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.RELAYER_PRIVATE_KEY ??= '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import { parseEnv } from './index';
import {
  DEFAULT_SETTLEMENT_VOID_GAP_MS,
  resolveSettlementVoidGapMs,
} from './settlement';

const BASE_ENV: NodeJS.ProcessEnv = {
  POSTGRES_URL: 'postgres://postgres:postgres@localhost:5432/st_backend',
  REDIS_URL: 'redis://localhost:6379',
  ENGINE_URL: 'ws://localhost:8090',
  ENGINE_TOKEN: 'test-engine-token',
  RPC_URL: 'https://sepolia.base.org',
  JWT_SECRET: 'test-jwt-secret',
  ADMIN_API_KEY: 'test-admin-api-key-0123456789abcdef',
  CELL_SIGNER_KEY: 'test-cell-signer-key',
  RELAYER_PRIVATE_KEY: '0x2222222222222222222222222222222222222222222222222222222222222222',
};

describe('settlement and price source config', () => {
  it('defaults SETTLEMENT_VOID_GAP_MS to 3000 and ENGINE_PRICE_SOURCE to hyperliquid', () => {
    const cfg = parseEnv({ ...BASE_ENV });
    expect(cfg.settlement.voidGapMs).toBe(DEFAULT_SETTLEMENT_VOID_GAP_MS);
    expect(cfg.settlement.voidGapMs).toBe(3000);
    expect(cfg.engine.priceSource).toBe('hyperliquid');
    expect(resolveSettlementVoidGapMs({})).toBe(3000);
  });

  it('accepts custom positive integer SETTLEMENT_VOID_GAP_MS and deribit ENGINE_PRICE_SOURCE', () => {
    const cfg = parseEnv({
      ...BASE_ENV,
      SETTLEMENT_VOID_GAP_MS: '1500',
      ENGINE_PRICE_SOURCE: 'deribit',
    });
    expect(cfg.settlement.voidGapMs).toBe(1500);
    expect(cfg.engine.priceSource).toBe('deribit');
    expect(resolveSettlementVoidGapMs({ SETTLEMENT_VOID_GAP_MS: '1500' })).toBe(
      1500,
    );
  });

  it('rejects invalid SETTLEMENT_VOID_GAP_MS and ENGINE_PRICE_SOURCE values', () => {
    for (const bad of ['0', '-5', '1.5', 'abc']) {
      expect(() =>
        parseEnv({ ...BASE_ENV, SETTLEMENT_VOID_GAP_MS: bad }),
      ).toThrow();
      expect(() =>
        resolveSettlementVoidGapMs({ SETTLEMENT_VOID_GAP_MS: bad }),
      ).toThrow();
    }
    expect(() =>
      parseEnv({ ...BASE_ENV, ENGINE_PRICE_SOURCE: 'binance' }),
    ).toThrow();
  });
});
