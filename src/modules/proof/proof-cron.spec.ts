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

import { ProofCronService } from './proof-cron.service';
import { BaseProofPublisher } from './publishers/base-proof.publisher';

function makeLockDataSource(acquired: boolean) {
  const query = vi
    .fn()
    .mockResolvedValueOnce([{ acquired }])
    .mockResolvedValueOnce([]);
  const release = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn().mockResolvedValue(undefined);
  const dataSource = {
    createQueryRunner: vi.fn().mockReturnValue({
      connect,
      query,
      release,
    }),
  };
  return { dataSource, query, release };
}

describe('ProofCronService', () => {
  it('posts one contiguous batch per 5-minute boundary when enabled and lock is acquired', async () => {
    const runNextWindow = vi.fn().mockResolvedValue({
      status: 'submitted',
      index: 0,
      fromMs: 1700000100000,
      toMs: 1700000400000,
      txHash: '0xtxhash',
    });
    const { dataSource, query, release } = makeLockDataSource(true);

    const cron = new ProofCronService(
      { runNextWindow } as any,
      dataSource as any,
      () => true,
    );
    await cron.runAutoAnchor();

    expect(runNextWindow).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [873611903],
    );
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_unlock($1)',
      [873611903],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips running when another instance holds the Postgres advisory lock', async () => {
    const runNextWindow = vi.fn();
    const { dataSource, query, release } = makeLockDataSource(false);

    const cron = new ProofCronService(
      { runNextWindow } as any,
      dataSource as any,
      () => true,
    );
    await cron.runAutoAnchor();

    expect(runNextWindow).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('PROOF_ANCHOR_ENABLED unset: no post is attempted', async () => {
    const runNextWindow = vi.fn();
    const { dataSource } = makeLockDataSource(true);

    const cron = new ProofCronService(
      { runNextWindow } as any,
      dataSource as any,
      () => false,
    );
    cron.onModuleInit();
    await cron.runAutoAnchor();

    expect(runNextWindow).not.toHaveBeenCalled();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });
});

describe('BaseProofPublisher startup validation', () => {
  it('fails at startup naming the missing variable when PROOF_ANCHOR_ENABLED is true and PROOF_ANCHOR_ADDRESS is missing', () => {
    const publisher = new BaseProofPublisher({
      enabled: true,
      rpcUrl: 'https://sepolia.base.org',
      contractAddress: '',
      relayerPrivateKey:
        '0x2222222222222222222222222222222222222222222222222222222222222222',
    });

    expect(() => publisher.onModuleInit()).toThrow(/PROOF_ANCHOR_ADDRESS/);
  });

  it('fails at startup naming RELAYER_PRIVATE_KEY without leaking its value', () => {
    const secret = 'invalid-secret-key-value-123';
    const publisher = new BaseProofPublisher({
      enabled: true,
      rpcUrl: 'https://sepolia.base.org',
      contractAddress: '0x1111111111111111111111111111111111111111',
      relayerPrivateKey: secret,
    });

    let thrown: Error | undefined;
    try {
      publisher.onModuleInit();
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain('RELAYER_PRIVATE_KEY');
    expect(thrown?.message).not.toContain(secret);
  });
});
