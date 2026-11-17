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

import { MetricsController } from './metrics.controller';
describe('human metrics', () => {
  it('returns human-only counts and bot wallets', async () => {
    const service = {
      metrics: vi.fn().mockResolvedValue({
        humanWallets: 2,
        humanTaps: 3,
        humanDeposits: 1,
        botWallets: 1,
      }),
    };
    expect(await new MetricsController(service as any).getMetrics()).toEqual({
      humanWallets: 2,
      humanTaps: 3,
      humanDeposits: 1,
      botWallets: 1,
    });
  });
});

it('restricts human metrics to non-bot player records', async () => {
  const { MetricsService } = await import('./metrics.controller');
  const query = vi.fn().mockResolvedValue([
    {
      humanWallets: '1',
      humanTaps: '2',
      humanDeposits: '3',
      botWallets: '1',
    },
  ]);
  expect(await new MetricsService({ query } as any).metrics()).toEqual({
    humanWallets: 1,
    humanTaps: 2,
    humanDeposits: 3,
    botWallets: 1,
  });
  expect(query.mock.calls[0][0]).toContain('p."isBot" = false');
});
