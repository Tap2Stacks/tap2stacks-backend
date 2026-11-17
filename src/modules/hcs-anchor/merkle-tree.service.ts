import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Order } from '../order/entities/order.entity';
import { OrderStatus } from '../order/types';
import {
  CanonicalSettledOrder,
  MerkleProofStep,
  PreparedSettledOrderBatch,
  PreparedSettledOrderLeaf,
} from './types';

@Injectable()
export class MerkleTreeService {
  sha256Hex(value: string | Buffer): string {
    return `0x${createHash('sha256').update(value).digest('hex')}`;
  }

  canonicalizeSettledOrder(order: Order): CanonicalSettledOrder {
    if (order.status !== OrderStatus.SETTLED) {
      throw new Error(`Order ${order.orderId} is not settled`);
    }

    if (order.settledAt == null || order.settledWin == null) {
      throw new Error(`Order ${order.orderId} is missing settlement data`);
    }

    return {
      schema: 'tap.settledOrder.v1',
      orderId: order.orderId,
      userId: order.userId,
      marketId: order.marketId,
      amount: order.amount,
      rewardRate: order.rewardRate,
      settledAt: order.settledAt,
      settledWin: order.settledWin,
      cellTimeStart: order.cellTimeStart,
      cellTimeEnd: order.cellTimeEnd,
      lowerPrice: order.lowerPrice,
      upperPrice: order.upperPrice,
    };
  }

  serializeCanonicalSettledOrder(order: CanonicalSettledOrder): string {
    return JSON.stringify(order);
  }

  hashSettledOrder(order: Order): string {
    return this.sha256Hex(
      this.serializeCanonicalSettledOrder(this.canonicalizeSettledOrder(order)),
    );
  }

  buildMerkleRoot(leafHashes: string[]): string {
    if (leafHashes.length === 0) {
      return this.sha256Hex('');
    }

    let layer = leafHashes.map((leafHash) => this.normalizeHex(leafHash));

    while (layer.length > 1) {
      const nextLayer: string[] = [];
      for (let index = 0; index < layer.length; index += 2) {
        const left = layer[index];
        const right = layer[index + 1] ?? left;
        nextLayer.push(this.hashPair(left, right));
      }
      layer = nextLayer;
    }

    return layer[0];
  }

  buildMerkleProof(
    leafHashes: string[],
    targetIndex: number,
  ): MerkleProofStep[] {
    if (targetIndex < 0 || targetIndex >= leafHashes.length) {
      throw new Error('Merkle proof target index is out of range');
    }

    const proof: MerkleProofStep[] = [];
    let index = targetIndex;
    let layer = leafHashes.map((leafHash) => this.normalizeHex(leafHash));

    while (layer.length > 1) {
      const isRightNode = index % 2 === 1;
      const pairIndex = isRightNode ? index - 1 : index + 1;
      const siblingHash = layer[pairIndex] ?? layer[index];

      proof.push({
        position: isRightNode ? 'left' : 'right',
        hash: siblingHash,
      });

      const nextLayer: string[] = [];
      for (let layerIndex = 0; layerIndex < layer.length; layerIndex += 2) {
        const left = layer[layerIndex];
        const right = layer[layerIndex + 1] ?? left;
        nextLayer.push(this.hashPair(left, right));
      }

      layer = nextLayer;
      index = Math.floor(index / 2);
    }

    return proof;
  }

  verifyMerkleProof(
    leafHash: string,
    proof: MerkleProofStep[],
    expectedRoot: string,
  ): boolean {
    let computedHash = this.normalizeHex(leafHash);

    for (const step of proof) {
      computedHash =
        step.position === 'left'
          ? this.hashPair(step.hash, computedHash)
          : this.hashPair(computedHash, step.hash);
    }

    return computedHash === this.normalizeHex(expectedRoot);
  }

  prepareSettledOrders(orders: Order[]): PreparedSettledOrderBatch {
    const sortedOrders = [...orders].sort((left, right) => {
      const leftSettledAt = left.settledAt ?? 0;
      const rightSettledAt = right.settledAt ?? 0;
      if (leftSettledAt !== rightSettledAt) {
        return leftSettledAt - rightSettledAt;
      }
      return left.orderId.localeCompare(right.orderId);
    });

    const leaves: PreparedSettledOrderLeaf[] = sortedOrders.map((order) => {
      const canonical = this.canonicalizeSettledOrder(order);
      const serialized = this.serializeCanonicalSettledOrder(canonical);
      return {
        order,
        canonical,
        serialized,
        leafHash: this.sha256Hex(serialized),
      };
    });

    const settledAtValues = leaves.map(({ canonical }) => canonical.settledAt);

    return {
      orderCount: leaves.length,
      leaves,
      merkleRoot: this.buildMerkleRoot(leaves.map(({ leafHash }) => leafHash)),
      windowStart:
        settledAtValues.length > 0 ? Math.min(...settledAtValues) : null,
      windowEnd:
        settledAtValues.length > 0 ? Math.max(...settledAtValues) : null,
    };
  }

  private hashPair(left: string, right: string): string {
    const leftBuffer = Buffer.from(this.stripHexPrefix(left), 'hex');
    const rightBuffer = Buffer.from(this.stripHexPrefix(right), 'hex');
    return this.sha256Hex(Buffer.concat([leftBuffer, rightBuffer]));
  }

  private normalizeHex(value: string): string {
    return `0x${this.stripHexPrefix(value).toLowerCase()}`;
  }

  private stripHexPrefix(value: string): string {
    return value.startsWith('0x') ? value.slice(2) : value;
  }
}
