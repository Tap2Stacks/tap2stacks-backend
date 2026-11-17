import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { env } from 'src/config';
import { HcsAnchorService } from './hcs-anchor.service';

@Injectable()
export class HcsAnchorCronService {
  private readonly logger = new Logger(HcsAnchorCronService.name);
  private isRunning = false;

  constructor(private readonly hcsAnchorService: HcsAnchorService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runAutoAnchor(): Promise<void> {
    if (!env.hcs.autoAnchorEnabled) {
      return;
    }

    if (this.isRunning) {
      this.logger.warn(
        'Skipping auto-anchor run because a previous run is still in progress',
      );
      return;
    }

    const pendingCount = await this.hcsAnchorService.countPendingSettledOrders();
    if (pendingCount === 0) {
      return;
    }

    this.isRunning = true;
    try {
      const result = await this.hcsAnchorService.runOnce();
      if (result.status === 'submitted') {
        this.logger.log(
          `Auto-anchored ${result.anchoredCount} settled orders in batch ${result.batchId}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown auto-anchor error';
      this.logger.error(`Auto-anchor run failed: ${message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
