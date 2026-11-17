import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Interface } from 'ethers';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import { PublicRateLimitGuard } from '../feed/public-rate-limit.guard';
import { MerkleTreeService } from './merkle-tree.service';
import { PriceLogService } from './price-log.service';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { BaseProofPublisher } from './publishers/base-proof.publisher';
import { SettlementAnchorBatchStatus } from './types';

const buildSettledOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    orderId: 'user-a:cell-1',
    userId: '0x1111111111111111111111111111111111111111',
    marketId: 'NVDA',
    ticker: 'NVDA',
    cellTimeStart: 1700000105000,
    cellTimeEnd: 1700000110000,
    lowerPrice: '157.40',
    upperPrice: '157.60',
    amount: '10',
    rewardRate: '1.9',
    placedAt: 1700000100000,
    status: OrderStatus.SETTLED,
    settledAt: 1700000106000,
    settledWin: true,
    ...overrides,
  }) as Order;

function makeOrderRepo(orders: Order[]) {
  return {
    find: vi.fn().mockResolvedValue(orders),
  };
}

function makePriceLogRepo(samples: any[] = []) {
  const qb = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(samples),
  };
  return {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
  };
}

describe('ProofController and batch verification routes', () => {
  it('uses PublicRateLimitGuard on ProofController', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ProofController);
    expect(guards).toEqual([PublicRateLimitGuard]);
  });

  it('GET /api/proofs/:index/taps returns a proof that verifies against tapsRoot', async () => {
    const merkle = new MerkleTreeService();
    const order1 = buildSettledOrder({ orderId: 'user-a:cell-1' });
    const order2 = buildSettledOrder({
      orderId: 'user-b:cell-2',
      status: OrderStatus.VOIDED,
      settledAt: 1700000107000,
      settledWin: undefined,
    });
    const prepared = merkle.prepareSettledOrders([order1, order2]);
    const batch = {
      batchId: 'proof_1700000100000_1700000400000',
      index: 7,
      fromMs: 1700000100000,
      toMs: 1700000400000,
      tapsRoot: prepared.merkleRoot,
      priceLogHash: '0x' + 'a'.repeat(64),
      txHash: '0xtx_7',
      status: SettlementAnchorBatchStatus.SUBMITTED,
      orderCount: 2,
    };

    const service = new ProofService(
      makeOrderRepo([order1, order2]) as any,
      { findOne: vi.fn().mockResolvedValue(batch) } as any,
      {} as any,
      merkle,
      new PriceLogService(makePriceLogRepo([]) as any),
      {} as any,
    );

    const controller = new ProofController(service);
    const result = await controller.getBatchTaps('7');

    expect(result.tapsRoot).toBe(prepared.merkleRoot);
    expect(result.taps).toHaveLength(2);
    expect(result.taps[1].status).toBe('VOIDED');
    expect(result.taps[1].ticker).toBe('NVDA');
    for (const tap of result.taps) {
      expect(
        merkle.verifyMerkleProof(tap.leafHash, tap.proof, result.tapsRoot),
      ).toBe(true);
    }
  });

  it('returns 404 for unknown index and 400 for non-integer index', async () => {
    const service = new ProofService(
      makeOrderRepo([]) as any,
      { findOne: vi.fn().mockResolvedValue(null) } as any,
      {} as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      {} as any,
    );
    const controller = new ProofController(service);

    await expect(controller.getBatchTaps('999')).rejects.toMatchObject({
      status: 404,
    });
    await expect(controller.getBatchTaps('abc')).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.getBatchTaps('-1')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('GET /api/proofs/:index/price-log writes exact NDJSON bytes and content-type', async () => {
    const samples = [
      { ticker: 'NVDA', tsMs: 1700000100100, price: '157.500000' },
    ];
    const service = new ProofService(
      makeOrderRepo([]) as any,
      {
        findOne: vi.fn().mockResolvedValue({
          batchId: 'b1',
          index: 2,
          fromMs: 1700000100000,
          toMs: 1700000400000,
          status: SettlementAnchorBatchStatus.SUBMITTED,
        }),
      } as any,
      {} as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo(samples) as any),
      {} as any,
    );
    const controller = new ProofController(service);
    const res = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await controller.getPriceLog('2', res as any);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
    expect(res.send.mock.calls[0][0].toString('utf8')).toBe(
      '{"ticker":"NVDA","tsMs":1700000100100,"price":"157.500000"}\n',
    );
  });

  it('GET /api/proofs returns submitted batches newest-first with limit capped at 50', async () => {
    const find = vi.fn().mockResolvedValue([
      {
        index: 5,
        fromMs: 1000,
        toMs: 301000,
        tapsRoot: '0x1',
        priceLogHash: '0x2',
        txHash: '0xtx',
      },
    ]);
    const service = new ProofService(
      makeOrderRepo([]) as any,
      { find } as any,
      {} as any,
      new MerkleTreeService(),
      new PriceLogService(makePriceLogRepo([]) as any),
      {} as any,
    );
    const controller = new ProofController(service);

    const list = await controller.getProofs('200', '10');
    expect(find).toHaveBeenCalledWith({
      where: { status: SettlementAnchorBatchStatus.SUBMITTED },
      order: { index: 'DESC' },
      take: 50,
      skip: 10,
    });
    expect(list).toEqual([
      {
        index: 5,
        fromMs: 1000,
        toMs: 301000,
        tapsRoot: '0x1',
        priceLogHash: '0x2',
        txHash: '0xtx',
      },
    ]);
  });
});

describe('BaseProofPublisher.post', () => {
  it('calls ProofAnchor.postRoot and parses index from RootPosted receipt log', async () => {
    const contractAddress = '0x1111111111111111111111111111111111111111';
    const iface = new Interface([
      'event RootPosted(uint256 indexed index, bytes32 tapsRoot, bytes32 priceLogHash, uint64 fromMs, uint64 toMs)',
    ]);
    const tapsRoot = '0x' + 'a'.repeat(64);
    const priceLogHash = '0x' + 'b'.repeat(64);
    const encodedLog = iface.encodeEventLog('RootPosted', [
      12n,
      tapsRoot,
      priceLogHash,
      1000n,
      301000n,
    ]);

    const postRoot = vi.fn().mockResolvedValue({
      hash: '0xtx_abc',
      wait: vi.fn().mockResolvedValue({
        hash: '0xtx_abc',
        logs: [
          {
            address: contractAddress,
            topics: encodedLog.topics,
            data: encodedLog.data,
          },
        ],
      }),
    });

    const publisher = new BaseProofPublisher(
      {
        enabled: true,
        rpcUrl: 'https://sepolia.base.org',
        contractAddress,
        relayerPrivateKey:
          '0x2222222222222222222222222222222222222222222222222222222222222222',
      },
      () => ({ postRoot }) as any,
    );

    const res = await publisher.post(tapsRoot, priceLogHash, 1000, 301000);
    expect(postRoot).toHaveBeenCalledWith(tapsRoot, priceLogHash, 1000, 301000);
    expect(res).toEqual({ txHash: '0xtx_abc', index: 12 });
  });
});
