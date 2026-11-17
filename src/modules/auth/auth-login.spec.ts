import { describe, expect, it, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

vi.hoisted(() => {
  process.env.POSTGRES_URL ??= 'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??= '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??= '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import { AuthService } from './auth.service';
import { SignatureVerifier } from './signature-verifier';

const ADDRESS = '0x1111111111111111111111111111111111111111';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

describe('AuthService.login', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let verifier: SignatureVerifier & { verify: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    redis = fakeRedis();
    verifier = { verify: vi.fn(async () => true) };
    service = new AuthService(redis as never, verifier);
  });

  it('issues a challenge naming tap2stacks', async () => {
    const challenge = await service.generateChallenge(ADDRESS);
    expect(challenge).toMatch(/^Sign this message to log in to tap2stacks: /);
  });

  it('logs in when the signature checker accepts, and uses the challenge once', async () => {
    const challenge = await service.generateChallenge(ADDRESS);

    const result = await service.login(ADDRESS, '0xabc');

    expect(verifier.verify).toHaveBeenCalledWith(ADDRESS, challenge, '0xabc');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.wssKey).toMatch(/^[0-9a-f]{64}$/);
    await expect(service.login(ADDRESS, '0xabc')).rejects.toThrow('Challenge not found');
  });

  it('rejects when the signature checker refuses', async () => {
    await service.generateChallenge(ADDRESS);
    verifier.verify.mockResolvedValueOnce(false);

    await expect(service.login(ADDRESS, '0xabc')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
