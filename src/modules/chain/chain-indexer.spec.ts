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

import { Interface, getAddress } from 'ethers';
import { ChainIndexerService } from './chain-indexer.service';
import { toLedgerAmount, toBaseUnits } from '../../libs/units';

const abi = [
  'event Deposited(address indexed player,uint256 amount)',
  'event Withdrawn(address indexed player,uint256 amount,uint256 nonce)',
];
const iface = new Interface(abi);
const player = '0x1111111111111111111111111111111111111111';
function setup(name: string, args: unknown[]) {
  const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
  const log = { ...encoded, transactionHash: '0xabc', index: 1 };
  const provider = {
    getBlockNumber: vi.fn().mockResolvedValue(12),
    getLogs: vi.fn().mockResolvedValue([log]),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 100 }),
  };
  let cursor: any = null;
  const repo = {
    findOneBy: vi.fn(async () => cursor),
    save: vi.fn(async (x) => {
      cursor = x;
      return x;
    }),
  };
  const payments = {
    handleDeposit: vi.fn().mockResolvedValue(undefined),
    handleWithdrawn: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ChainIndexerService(
    repo as any,
    payments as any,
    provider as any,
    { vaultAddress: player, deployBlock: 1 },
  );
  return { service, provider, repo, payments };
}
describe('chain indexer', () => {
  it('credits a Deposited log once even if polled twice', async () => {
    const { service, payments } = setup('Deposited', [player, 12500000n]);
    await service.pollOnce();
    await service.pollOnce();
    expect(payments.handleDeposit).toHaveBeenCalledTimes(1);
    expect(payments.handleDeposit).toHaveBeenCalledWith(
      player,
      '12.5',
      '0xabc',
      1,
    );
  });
  it('credits a lowercase Deposited player to the checksummed JWT account', async () => {
    const address = '0xaabbccddeeff0011223344556677889900aabbcc';
    const { service, payments } = setup('Deposited', [address, 1000000n]);
    await service.pollOnce();
    expect(payments.handleDeposit).toHaveBeenCalledWith(
      getAddress(address),
      '1.0',
      '0xabc',
      1,
    );
  });
  it('logs unmatched withdrawals with identifying fields and does not advance', async () => {
    const address = '0xaabbccddeeff0011223344556677889900aabbcc';
    const { service, payments, repo } = setup('Withdrawn', [
      address,
      1000000n,
      3n,
    ]);
    const logger = vi
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => {});
    payments.handleWithdrawn.mockRejectedValue(
      new Error('No matching withdrawal session'),
    );
    await expect(service.pollOnce()).rejects.toThrow(
      'No matching withdrawal session',
    );
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('0xabc'));
    expect(logger.mock.calls[0][0]).toContain(getAddress(address));
    expect(logger.mock.calls[0][0]).toContain('nonce=3');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('converts six-decimal base units', () => {
    expect(toLedgerAmount(12500000n)).toBe(12.5);
    expect(toBaseUnits(12.5)).toBe(12500000n);
  });
  it('does not advance the cursor if a log fails', async () => {
    const { service, repo, payments } = setup('Deposited', [player, 1n]);
    payments.handleDeposit.mockRejectedValueOnce(new Error('failure'));
    await expect(service.pollOnce()).rejects.toThrow('failure');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('matches a withdrawal by player, amount and nonce', async () => {
    const { service, payments } = setup('Withdrawn', [player, 12500000n, 3n]);
    await service.pollOnce();
    expect(payments.handleWithdrawn).toHaveBeenCalledWith(
      player,
      '12.5',
      '3',
      '0xabc',
      1,
    );
  });
  it('replays a withdrawal after session persistence fails and advances the cursor', async () => {
    const { service, payments, repo } = setup('Withdrawn', [
      player,
      5000000n,
      3n,
    ]);
    let ledgerApplied = false;
    let effects = 0;
    payments.handleWithdrawn.mockImplementation(async () => {
      if (!ledgerApplied) {
        ledgerApplied = true;
        effects++;
        throw new Error('session save failed');
      }
    });
    await expect(service.pollOnce()).rejects.toThrow('session save failed');
    expect(repo.save).not.toHaveBeenCalled();
    await service.pollOnce();
    expect(effects).toBe(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ block: 10 }),
    );
  });
});
