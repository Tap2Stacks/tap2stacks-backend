import { describe, expect, it } from 'vitest';
import { MerkleTreeService } from './merkle-tree.service';
import { OrderStatus } from '../order/types';
import { Order } from '../order/entities/order.entity';

const buildSettledOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    orderId: 'user-a:cell-1',
    userId: '0x1111111111111111111111111111111111111111',
    marketId: 'NVDA',
    ticker: 'NVDA',
    cellTimeStart: 1000,
    cellTimeEnd: 2000,
    lowerPrice: '150.00',
    upperPrice: '155.00',
    amount: '100',
    rewardRate: '1.9',
    placedAt: 900,
    status: OrderStatus.SETTLED,
    settledAt: 1500,
    settledWin: true,
    ...overrides,
  }) as Order;

describe('MerkleTreeService', () => {
  it('creates deterministic tap2stacks.settledOrder.v1 leaves including VOIDED taps with ticker and status', () => {
    const service = new MerkleTreeService();
    const wonOrder = buildSettledOrder();
    const lostOrder = buildSettledOrder({
      orderId: 'user-b:cell-2',
      userId: '0x2222222222222222222222222222222222222222',
      ticker: 'TSLA',
      marketId: 'TSLA',
      settledAt: 1800,
      settledWin: false,
    });
    const voidedOrder = buildSettledOrder({
      orderId: 'user-c:cell-3',
      userId: '0x3333333333333333333333333333333333333333',
      ticker: 'NVDA',
      marketId: 'NVDA',
      status: OrderStatus.VOIDED,
      settledAt: 1600,
      settledWin: undefined,
    });

    const firstRun = service.prepareSettledOrders([
      lostOrder,
      voidedOrder,
      wonOrder,
    ]);
    const secondRun = service.prepareSettledOrders([
      wonOrder,
      lostOrder,
      voidedOrder,
    ]);

    expect(firstRun.leaves.map((leaf) => leaf.order.orderId)).toEqual([
      'user-a:cell-1',
      'user-c:cell-3',
      'user-b:cell-2',
    ]);
    expect(firstRun.merkleRoot).toBe(secondRun.merkleRoot);
    expect(firstRun.leaves[0].canonical).toMatchObject({
      schema: 'tap2stacks.settledOrder.v1',
      ticker: 'NVDA',
      status: 'WON',
    });
    expect(firstRun.leaves[1].canonical).toMatchObject({
      schema: 'tap2stacks.settledOrder.v1',
      ticker: 'NVDA',
      status: 'VOIDED',
      settledWin: null,
    });
    expect(firstRun.leaves[2].canonical).toMatchObject({
      schema: 'tap2stacks.settledOrder.v1',
      ticker: 'TSLA',
      status: 'LOST',
    });
    expect(firstRun.leaves[0].leafHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects orders without full settlement data', () => {
    const service = new MerkleTreeService();
    const invalidOrder = buildSettledOrder({ settledAt: undefined });

    expect(() => service.prepareSettledOrders([invalidOrder])).toThrow(
      'missing settlement data',
    );
  });

  it('builds a proof that verifies against the computed merkle root', () => {
    const service = new MerkleTreeService();
    const batch = service.prepareSettledOrders([
      buildSettledOrder(),
      buildSettledOrder({
        orderId: 'user-b:cell-2',
        userId: '0x2222222222222222222222222222222222222222',
        settledAt: 1800,
      }),
      buildSettledOrder({
        orderId: 'user-c:cell-3',
        userId: '0x3333333333333333333333333333333333333333',
        status: OrderStatus.VOIDED,
        settledAt: 2200,
        settledWin: undefined,
      }),
    ]);

    const proof = service.buildMerkleProof(
      batch.leaves.map((leaf) => leaf.leafHash),
      1,
    );

    expect(
      service.verifyMerkleProof(
        batch.leaves[1].leafHash,
        proof,
        batch.merkleRoot,
      ),
    ).toBe(true);
  });

  it('builds a proof that verifies against the computed merkle root for five leaves', () => {
    const service = new MerkleTreeService();
    const batch = service.prepareSettledOrders([
      buildSettledOrder({ orderId: 'user-a:cell-1', settledAt: 1500 }),
      buildSettledOrder({ orderId: 'user-b:cell-2', settledAt: 1800 }),
      buildSettledOrder({ orderId: 'user-c:cell-3', settledAt: 2200 }),
      buildSettledOrder({ orderId: 'user-d:cell-4', settledAt: 2600 }),
      buildSettledOrder({ orderId: 'user-e:cell-5', settledAt: 3000 }),
    ]);

    const proof = service.buildMerkleProof(
      batch.leaves.map((leaf) => leaf.leafHash),
      0,
    );

    expect(
      service.verifyMerkleProof(
        batch.leaves[0].leafHash,
        proof,
        batch.merkleRoot,
      ),
    ).toBe(true);
  });
});
