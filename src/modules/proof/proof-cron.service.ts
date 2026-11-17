import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { env } from 'src/config';
import { ProofService } from './proof.service';

export const PROOF_ANCHOR_ENABLED_FN = Symbol('PROOF_ANCHOR_ENABLED_FN');
const PROOF_CRON_ADVISORY_LOCK_ID = 873611903;

@Injectable()
export class ProofCronService implements OnModuleInit {
  private readonly logger = new Logger(ProofCronService.name);

  constructor(
    private readonly proofService: ProofService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @Inject(PROOF_ANCHOR_ENABLED_FN)
    private readonly isEnabled: () => boolean = () =>
      env.flag.proofAnchorEnabled,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        'Proof anchoring is disabled (PROOF_ANCHOR_ENABLED != true)',
      );
    }
  }

  @Cron('5 */5 * * * *')
  async runAutoAnchor(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    await this.withAnchorLock(async () => {
      try {
        await this.proofService.runNextWindow();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown auto-anchor error';
        this.logger.error(`Auto-anchor run failed: ${message}`);
      }
    });
  }

  private async withAnchorLock(work: () => Promise<void>): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    let acquired = false;
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [PROOF_CRON_ADVISORY_LOCK_ID],
      );
      acquired = rows[0]?.acquired === true;
      if (acquired) {
        await work();
      }
    } finally {
      try {
        if (acquired) {
          await runner.query('SELECT pg_advisory_unlock($1)', [
            PROOF_CRON_ADVISORY_LOCK_ID,
          ]);
        }
      } finally {
        await runner.release();
      }
    }
  }
}
