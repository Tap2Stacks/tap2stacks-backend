import { describe, expect, it } from 'vitest';
import { MerkleTreeService } from './merkle-tree.service';
import { OrderStatus } from '../order/types';
import { Order } from '../order/entities/order.entity';

const buildSettledOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    orderId: 'user-a:cell-1',
    userId: 'user-a',
    marketId: 'btc',
    cellTimeStart: 1000,
    cellTimeEnd: 2000,
    lowerPrice: '95000',
    upperPrice: '96000',
    amount: '100',
    rewardRate: '1.9',
    placedAt: 900,
    status: OrderStatus.SETTLED,
    settledAt: 1500,
    settledWin: true,
    ...overrides,
  }) as Order;

describe('MerkleTreeService', () => {
  it('creates deterministic settled order hashes and merkle roots', () => {
    const service = new MerkleTreeService();
    const firstOrder = buildSettledOrder();
    const secondOrder = buildSettledOrder({
      orderId: 'user-b:cell-2',
      userId: 'user-b',
      settledAt: 1800,
      settledWin: false,
    });

    const firstRun = service.prepareSettledOrders([secondOrder, firstOrder]);
    const secondRun = service.prepareSettledOrders([firstOrder, secondOrder]);

    expect(firstRun.leaves.map((leaf) => leaf.order.orderId)).toEqual([
      'user-a:cell-1',
      'user-b:cell-2',
    ]);
    expect(firstRun.merkleRoot).toBe(secondRun.merkleRoot);
    expect(firstRun.leaves[0].serialized).toContain(
      '"schema":"tap.settledOrder.v1"',
    );
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
        userId: 'user-b',
        settledAt: 1800,
      }),
      buildSettledOrder({
        orderId: 'user-c:cell-3',
        userId: 'user-c',
        settledAt: 2200,
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
      buildSettledOrder({
        orderId: 'user-b:cell-2',
        userId: 'user-b',
        settledAt: 1800,
      }),
      buildSettledOrder({
        orderId: 'user-c:cell-3',
        userId: 'user-c',
        settledAt: 2200,
      }),
      buildSettledOrder({
        orderId: 'user-d:cell-4',
        userId: 'user-d',
        settledAt: 2600,
      }),
      buildSettledOrder({
        orderId: 'user-e:cell-5',
        userId: 'user-e',
        settledAt: 3000,
      }),
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
