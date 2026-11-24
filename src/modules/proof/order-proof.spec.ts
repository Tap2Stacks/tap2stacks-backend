import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PriceSample } from '../engine/price-sample.entity';
import { PublicRateLimitGuard } from '../feed/public-rate-limit.guard';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { MerkleTreeService } from './merkle-tree.service';
import { PriceLogService } from './price-log.service';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { PROOF_PUBLISHER } from './publishers/base-proof.publisher';
import { SettlementAnchorBatchStatus } from './types';

const UUID_1 = '01950000-0000-7000-8000-000000000001';
const UUID_2 = '01950000-0000-7000-8000-000000000002';
const UUID_UNANCHORED = '01950000-0000-7000-8000-000000000003';
const UUID_UNKNOWN = '01950000-0000-7000-8000-000000000099';
const COMPOSITE_ORDER_ID = `0x1111111111111111111111111111111111111111:NVDA:1700000401000:1700000406000:157.40:157.60:${UUID_1}`;

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: UUID_1,
    userId: '0x1111111111111111111111111111111111111111',
    marketId: 'NVDA',
    ticker: 'NVDA',
    cellTimeStart: 1700000401000,
    cellTimeEnd: 1700000406000,
    lowerPrice: '157.40',
    upperPrice: '157.60',
    amount: '10',
    rewardRate: '1.9',
    placedAt: 1700000395000,
    status: OrderStatus.SETTLED,
    settledAt: 1700000405000,
    settledWin: true,
    anchorBatchId: 'proof_1700000400000_1700000700000',
    ...overrides,
  } as Order;
}

describe('GET /api/proofs/orders/:orderId', () => {
  const merkle = new MerkleTreeService();
  const prevBatch = {
    batchId: 'proof_1700000100000_1700000400000',
    index: 11,
    fromMs: 1700000100000,
    toMs: 1700000400000,
    tapsRoot: '0x' + '1'.repeat(64),
    priceLogHash: '0x' + '2'.repeat(64),
    txHash: '0xtx_11',
    status: SettlementAnchorBatchStatus.SUBMITTED,
    orderCount: 0,
  };

  const boundaryOrder = buildOrder({
    orderId: COMPOSITE_ORDER_ID,
    cellTimeStart: 1700000401000, // 401000 - 3000 = 398000 < 400000 -> needs batch 11 + 12
    cellTimeEnd: 1700000406000,
    settledAt: 1700000405000,
  });
  const interiorOrder = buildOrder({
    orderId: UUID_2,
    cellTimeStart: 1700000405000, // 405000 - 3000 = 402000 >= 400000 -> needs only batch 12
    cellTimeEnd: 1700000410000,
    settledAt: 1700000409000,
  });
  const unanchoredOrder = buildOrder({
    orderId: UUID_UNANCHORED,
    anchorBatchId: undefined,
  });

  const preparedBatch12 = merkle.prepareSettledOrders([
    boundaryOrder,
    interiorOrder,
  ]);
  const mainBatch = {
    batchId: 'proof_1700000400000_1700000700000',
    index: 12,
    fromMs: 1700000400000,
    toMs: 1700000700000,
    tapsRoot: preparedBatch12.merkleRoot,
    priceLogHash: '0x' + 'a'.repeat(64),
    txHash: '0xtx_12',
    status: SettlementAnchorBatchStatus.SUBMITTED,
    orderCount: 2,
  };

  const allOrders = [boundaryOrder, interiorOrder, unanchoredOrder];
  const allBatches = [prevBatch, mainBatch];

  let app: INestApplication;

  beforeAll(async () => {
    const orderRepo = {
      findOneBy: vi.fn(
        async ({ orderId }: { orderId: string }) =>
          allOrders.find((o) => o.orderId === orderId) ?? null,
      ),
      find: vi.fn(async ({ where }: { where: { anchorBatchId?: string } }) =>
        where?.anchorBatchId === mainBatch.batchId
          ? [boundaryOrder, interiorOrder]
          : [],
      ),
    };

    const batchRepo = {
      findOneBy: vi.fn(
        async ({ batchId }: { batchId: string }) =>
          allBatches.find((b) => b.batchId === batchId) ?? null,
      ),
      findOne: vi.fn(
        async ({ where }: any) =>
          allBatches.find(
            (b) => b.index === where?.index && b.status === where?.status,
          ) ?? null,
      ),
      createQueryBuilder: vi.fn(() => {
        let coverEnd = Infinity;
        let coverStart = -Infinity;
        let statusFilter = SettlementAnchorBatchStatus.SUBMITTED;
        const qb: any = {
          where: (_clause: string, params: any) => {
            if (params?.status) statusFilter = params.status;
            return qb;
          },
          andWhere: (_clause: string, params: any) => {
            if (params?.coverEnd !== undefined) coverEnd = params.coverEnd;
            if (params?.coverStart !== undefined)
              coverStart = params.coverStart;
            return qb;
          },
          orderBy: () => qb,
          getMany: async () =>
            allBatches
              .filter(
                (b) =>
                  b.status === statusFilter &&
                  b.fromMs <= coverEnd &&
                  b.toMs > coverStart,
              )
              .sort((a, b) => a.index - b.index),
        };
        return qb;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProofController],
      providers: [
        ProofService,
        MerkleTreeService,
        PriceLogService,
        PublicRateLimitGuard,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        {
          provide: getRepositoryToken(SettlementAnchorBatch),
          useValue: batchRepo,
        },
        { provide: getRepositoryToken(PriceSample), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PROOF_PUBLISHER, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns tap, batch, verifying Merkle proof, and includes previous batch in priceLogIndexes when cellTimeStart - 3000 < batch.fromMs', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/proofs/orders/${encodeURIComponent(COMPOSITE_ORDER_ID)}`)
      .expect(200);

    expect(res.body.orderId).toBe(COMPOSITE_ORDER_ID);
    expect(res.body.batch).toEqual({
      index: 12,
      fromMs: 1700000400000,
      toMs: 1700000700000,
      tapsRoot: preparedBatch12.merkleRoot,
      priceLogHash: '0x' + 'a'.repeat(64),
      txHash: '0xtx_12',
    });
    expect(res.body.tap.orderId).toBe(COMPOSITE_ORDER_ID);
    expect(res.body.priceLogIndexes).toEqual([11, 12]);
    expect(
      merkle.verifyMerkleProof(
        res.body.tap.leafHash,
        res.body.tap.proof,
        res.body.batch.tapsRoot,
      ),
    ).toBe(true);
  });

  it('returns only the own batch in priceLogIndexes when cellTimeStart - 3000 >= batch.fromMs', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/proofs/orders/${UUID_2}`)
      .expect(200);

    expect(res.body.orderId).toBe(UUID_2);
    expect(res.body.priceLogIndexes).toEqual([12]);
    expect(
      merkle.verifyMerkleProof(
        res.body.tap.leafHash,
        res.body.tap.proof,
        res.body.batch.tapsRoot,
      ),
    ).toBe(true);
  });

  it('returns 404 PROOF_PENDING for unanchored order, 404 ORDER_NOT_FOUND for unknown uuid, and 400 for invalid orderId', async () => {
    const pendingRes = await request(app.getHttpServer())
      .get(`/api/proofs/orders/${UUID_UNANCHORED}`)
      .expect(404);
    expect(pendingRes.body).toMatchObject({ code: 'PROOF_PENDING' });

    const missingRes = await request(app.getHttpServer())
      .get(`/api/proofs/orders/${UUID_UNKNOWN}`)
      .expect(404);
    expect(missingRes.body).toMatchObject({ code: 'ORDER_NOT_FOUND' });

    await request(app.getHttpServer())
      .get('/api/proofs/orders/abc')
      .expect(400);
  });

  it('keeps GET /api/proofs/12/taps working without route collision', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/proofs/12/taps')
      .expect(200);

    expect(res.body.index).toBe(12);
    expect(res.body.taps).toHaveLength(2);
  });

  it('uses configured SETTLEMENT_VOID_GAP_MS when computing covering priceLogIndexes', async () => {
    const prevEnv = process.env.SETTLEMENT_VOID_GAP_MS;
    try {
      // interiorOrder has cellTimeStart=1700000405000 and mainBatch.fromMs=1700000400000 (5000 ms inside).
      // With SETTLEMENT_VOID_GAP_MS=6000, 405000 - 6000 = 399000 < 400000 -> must include batch 11 too.
      process.env.SETTLEMENT_VOID_GAP_MS = '6000';
      const res = await request(app.getHttpServer())
        .get(`/api/proofs/orders/${UUID_2}`)
        .expect(200);
      expect(res.body.priceLogIndexes).toEqual([11, 12]);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.SETTLEMENT_VOID_GAP_MS;
      } else {
        process.env.SETTLEMENT_VOID_GAP_MS = prevEnv;
      }
    }
  });
});
