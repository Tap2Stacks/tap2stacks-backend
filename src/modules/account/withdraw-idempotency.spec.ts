import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.POSTGRES_URL ??=
    'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??=
    '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??=
    '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import { AccountService } from './account.service';
describe('withdrawal ledger replay', () => {
  it('returns before checking balance for already-applied withdrawals and cancellations', async () => {
    const queue = { enqueue: vi.fn((_id, fn) => fn()) };
    const ledger = { findEntry: vi.fn().mockResolvedValue({ id: 'applied' }) };
    const balance = {
      get: vi.fn(() => {
        throw new Error('balance should not be read');
      }),
    };
    const service = new AccountService(
      queue as any,
      {} as any,
      ledger as any,
      balance as any,
      {} as any,
    );
    await service.withdrawSucceeded('player', '5', '0xtx', 1);
    await service.withdrawCancelled('player', '5', 'session');
    expect(ledger.findEntry).toHaveBeenCalledTimes(2);
  });
});
