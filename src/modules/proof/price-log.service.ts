import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import BigNumber from 'bignumber.js';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { PriceSample } from '../engine/price-sample.entity';

export type PriceSampleRow = Pick<PriceSample, 'ticker' | 'tsMs' | 'price'>;

@Injectable()
export class PriceLogService {
  constructor(
    @InjectRepository(PriceSample)
    private readonly priceSampleRepo: Repository<PriceSample>,
  ) {}

  async build(fromMs: number, toMs: number): Promise<Buffer> {
    const samples = await this.priceSampleRepo
      .createQueryBuilder('sample')
      .where('sample.tsMs >= :fromMs', { fromMs })
      .andWhere('sample.tsMs < :toMs', { toMs })
      .orderBy('sample.ticker', 'ASC')
      .addOrderBy('sample.tsMs', 'ASC')
      .getMany();

    return this.formatSamples(samples);
  }

  async buildWithHash(
    fromMs: number,
    toMs: number,
  ): Promise<{ buffer: Buffer; hash: string }> {
    const buffer = await this.build(fromMs, toMs);
    return { buffer, hash: this.hashBuffer(buffer) };
  }

  formatSamples(samples: readonly PriceSampleRow[]): Buffer {
    if (samples.length === 0) {
      return Buffer.alloc(0);
    }

    const sorted = [...samples].sort((left, right) => {
      if (left.ticker !== right.ticker) {
        return left.ticker < right.ticker ? -1 : 1;
      }
      return Number(left.tsMs) - Number(right.tsMs);
    });

    const lines = sorted.map((sample) =>
      JSON.stringify({
        ticker: sample.ticker,
        tsMs: Number(sample.tsMs),
        price: new BigNumber(sample.price).toFixed(6),
      }),
    );

    return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  }

  hashBuffer(buffer: Buffer): string {
    return `0x${createHash('sha256').update(buffer).digest('hex')}`;
  }
}
