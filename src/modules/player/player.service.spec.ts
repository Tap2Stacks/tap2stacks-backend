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

import { PlayerService } from './player.service';
describe('players', () => {
  it('requires both attestations for a first login', async () => {
    const service = new PlayerService({
      findOneBy: vi.fn().mockResolvedValue(null),
    } as any);
    await expect(
      service.getOrCreate(
        '0x1111111111111111111111111111111111111111',
        false,
        true,
        null,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { error: 'ATTESTATION_REQUIRED' },
    });
  });
});

it('flags a configured bot case-insensitively', async () => {
  const { env } = await import('../../config');
  const bot = '0x1111111111111111111111111111111111111111';
  env.botWallets.push(bot.toUpperCase());
  try {
    const repo = {
      findOneBy: vi.fn().mockResolvedValue(null),
      create: vi.fn((x) => x),
      save: vi.fn((x) => x),
    };
    const player = await new PlayerService(repo as any).getOrCreate(
      bot,
      true,
      true,
      'VN',
    );
    expect(player.isBot).toBe(true);
  } finally {
    env.botWallets.pop();
  }
});
