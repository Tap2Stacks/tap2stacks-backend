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

import { FeedController } from './feed.controller';
import { PublicRateLimitGuard } from './public-rate-limit.guard';

describe('public feed', () => {
  it('validates limit and returns grouped entries newest first', async () => {
    const order = {
      userId: '0x123456',
      ticker: 'NVDA',
      marketId: 'NVDA',
      cellTimeStart: 1,
      cellTimeEnd: 2,
      lowerPrice: '1',
      upperPrice: '2',
      amount: '1',
      rewardRate: '2',
      settledWin: true,
    };
    const find = vi.fn().mockResolvedValue([
      { ...order, settledAt: 2 },
      { ...order, settledAt: 3 },
    ]);
    const controller = new FeedController({ find } as any);
    await expect(controller.recent('0')).rejects.toThrow();
    await expect(controller.recent('101')).rejects.toThrow();
    const result = await controller.recent();
    expect(result.map((entry) => entry.ts)).toEqual([3, 2]);
    expect(JSON.stringify(result)).not.toContain(order.userId);
    expect(find.mock.calls[0][0].take).toBe(300);
  });
  it('limits requests per IP with a shared bucket', async () => {
    const guard = new PublicRateLimitGuard();
    const context = (ip: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as any;
    for (let i = 0; i < 20; i++)
      await expect(guard.canActivate(context('a'))).resolves.toBe(true);
    await expect(guard.canActivate(context('a'))).rejects.toMatchObject({
      status: 429,
    });
    await expect(guard.canActivate(context('b'))).resolves.toBe(true);
  });
});
