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

import { getAddress } from 'ethers';
import { WithdrawalStatus } from './entities/withdrawal-session.entity';
import { PaymentService } from './payment.service';

describe('withdrawals', () => {
  it('rejects amount above free balance', async () => {
    const account = {
      withdrawRequested: vi
        .fn()
        .mockRejectedValue(new Error('Insufficient free balance')),
      hasEconomicEvent: vi.fn().mockResolvedValue(false),
    };
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((x) => x),
      save: vi.fn((x) => x),
      delete: vi.fn(),
      update: vi.fn(),
    };
    const signer = {
      available: () => true,
      nonce: vi.fn().mockResolvedValue(1n),
    };
    const service = new PaymentService(
      account as any,
      signer as any,
      {} as any,
      {} as any,
      repo as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.requestWithdrawal(
        '0x1111111111111111111111111111111111111111',
        '10',
      ),
    ).rejects.toThrow('Insufficient free balance');
  });
  it('locks funds on the checksummed JWT account', async () => {
    const userId = getAddress('0xaabbccddeeff0011223344556677889900aabbcc');
    const account = { withdrawRequested: vi.fn(), hasEconomicEvent: vi.fn() };
    const repo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((x) => x),
      save: vi.fn((x) => x),
    };
    const signer = {
      available: () => true,
      nonce: vi.fn().mockResolvedValue(1n),
      sign: vi.fn().mockResolvedValue('signed'),
      vault: 'vault',
    };
    const service = new PaymentService(
      account as any,
      signer as any,
      {} as any,
      {} as any,
      repo as any,
      { emitWithdrawQueued: vi.fn() } as any,
      {} as any,
    );
    await service.requestWithdrawal(userId, '5');
    expect(account.withdrawRequested).toHaveBeenCalledWith(
      userId,
      '5.0',
      expect.any(String),
    );
  });
  it('returns the same permit while a session is OPEN', async () => {
    const session = {
      userId: '0x1111111111111111111111111111111111111111',
      status: 'OPEN',
      amount: '5',
      nonce: '1',
      expiresAt: new Date(2000000),
      approvalSignature: 'signed',
    };
    const repo = { findOne: vi.fn().mockResolvedValue(session) };
    const signer = { available: () => true, vault: 'vault' };
    const service = new PaymentService(
      {} as any,
      signer as any,
      {} as any,
      {} as any,
      repo as any,
      {} as any,
      {} as any,
    );
    expect(await service.requestWithdrawal(session.userId, '1')).toMatchObject({
      amountBase: '5000000',
      nonce: '1',
      deadline: 2000,
      signature: 'signed',
      vault: 'vault',
    });
  });
});

describe('withdrawal recovery', () => {
  const session = {
    sessionId: 'session',
    userId: '0x1111111111111111111111111111111111111111',
    status: 'OPEN',
    amount: '5',
    nonce: '1',
    expiresAt: new Date(1000000),
    approvalSignature: 'signed',
  };
  function setup(confirmed: number | null, locked = true) {
    const account = {
      withdrawCancelled: vi.fn().mockResolvedValue(undefined),
      hasEconomicEvent: vi.fn().mockResolvedValue(locked),
      withdrawSucceeded: vi.fn().mockResolvedValue(undefined),
    };
    const repo = {
      find: vi.fn(async (query) =>
        query.where.status === WithdrawalStatus.OPEN ? [session] : [],
      ),
      findOne: vi.fn().mockResolvedValue(session),
      save: vi.fn((x) => Promise.resolve(x)),
    };
    const signer = {
      available: () => true,
      sign: vi.fn().mockResolvedValue('signed'),
      vault: 'vault',
    };
    const events = {
      emitWithdrawCancelled: vi.fn(),
      emitWithdrawQueued: vi.fn(),
      emitWithdrawSuccess: vi.fn(),
    };
    const indexer = {
      confirmedTimestamp: vi.fn().mockResolvedValue(confirmed),
    };
    const history = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((x) => x),
      save: vi.fn((x) => Promise.resolve(x)),
    };
    const runner = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue([{ acquired: true }]),
      release: vi.fn(),
    };
    return {
      runner,
      service: new PaymentService(
        account as any,
        signer as any,
        {} as any,
        history as any,
        repo as any,
        events as any,
        indexer as any,
        { createQueryRunner: () => runner } as any,
      ),
      account,
      repo,
      signer,
      history,
    };
  }
  it('does not cancel while confirmed chain is behind deadline', async () => {
    const { service, account } = setup(1000);
    await service.expireWithdrawals();
    expect(account.withdrawCancelled).not.toHaveBeenCalled();
  });
  it('cancels after the confirmed block passes the deadline', async () => {
    const { service, account, repo } = setup(1001);
    await service.expireWithdrawals();
    expect(account.withdrawCancelled).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'EXPIRED' }),
    );
  });
  it('reconciles a pending session with a lock entry', async () => {
    const { service, repo, signer } = setup(999);
    repo.find.mockResolvedValue([{ ...session, status: 'PENDING' }]);
    await service.reconcilePending();
    expect(signer.sign).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN' }),
    );
  });
  it('clears a pending session without a lock entry', async () => {
    const { service, repo, signer } = setup(999, false);
    repo.find.mockResolvedValue([{ ...session, status: 'PENDING' }]);
    await service.reconcilePending();
    expect(signer.sign).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' }),
    );
  });
  it('reconciles old pending sessions on cron and leaves fresh sessions alone', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
      const { service, repo, signer } = setup(null);
      const old = {
        ...session,
        status: 'PENDING',
        createdAt: new Date('2026-01-01T00:02:00Z'),
      };
      const fresh = {
        ...session,
        sessionId: 'fresh',
        status: 'PENDING',
        createdAt: new Date('2026-01-01T00:04:00Z'),
      };
      repo.find.mockImplementation(async (query) => {
        const cutoff = query.where.createdAt.value as Date;
        return [old, fresh].filter((item) => item.createdAt < cutoff);
      });
      await service.expireWithdrawals();
      expect(signer.sign).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session', status: 'OPEN' }),
      );
      expect(repo.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'fresh' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it('skips recovery if the advisory lock is unavailable', async () => {
    const { service, runner, repo } = setup(1001);
    runner.query.mockResolvedValue([{ acquired: false }]);
    await service.expireWithdrawals();
    await service.reconcilePending();
    expect(repo.find).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(2);
  });
  it('replays a withdrawal after a crash before saving the session', async () => {
    const { service, account, repo } = setup(999);
    repo.save.mockRejectedValueOnce(new Error('crash'));
    await expect(
      service.handleWithdrawn(session.userId, '5', '1', '0xtx', 0),
    ).rejects.toThrow('crash');
    await service.handleWithdrawn(session.userId, '5', '1', '0xtx', 0);
    expect(account.withdrawSucceeded).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });
});
