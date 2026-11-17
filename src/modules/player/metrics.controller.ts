import { Controller, Get, Injectable, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PublicRateLimitGuard } from '../feed/public-rate-limit.guard';
@Injectable()
export class MetricsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}
  async metrics() {
    const [row] = await this.db.query(`SELECT
      (SELECT count(*) FROM players WHERE "isBot" = false) AS "humanWallets",
      (SELECT count(*) FROM players WHERE "isBot" = true) AS "botWallets",
      (SELECT count(*) FROM orders o JOIN players p ON p.address = o."userId" WHERE p."isBot" = false) AS "humanTaps",
      (SELECT count(*) FROM deposit_history d JOIN players p ON p.address = d."userId" WHERE p."isBot" = false) AS "humanDeposits"`);
    return {
      humanWallets: Number(row.humanWallets),
      humanTaps: Number(row.humanTaps),
      humanDeposits: Number(row.humanDeposits),
      botWallets: Number(row.botWallets),
    };
  }
}
@Controller('metrics')
@UseGuards(PublicRateLimitGuard)
export class MetricsController {
  constructor(private readonly service: MetricsService) {}
  @Get() getMetrics() {
    return this.service.metrics();
  }
}
