import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Interface, JsonRpcProvider, formatUnits, getAddress } from 'ethers';
import { Repository } from 'typeorm';
import { PaymentService } from '../payment/payment.service';
import { ChainCursor } from './chain-cursor.entity';
import vaultAbi from '../../abi/Tap2StacksVault.json';

export const CHAIN_PROVIDER = Symbol('CHAIN_PROVIDER');
export const CHAIN_CONFIG = Symbol('CHAIN_CONFIG');
type ChainConfig = { vaultAddress: string; deployBlock: number | null };
@Injectable()
export class ChainIndexerService {
  private readonly logger = new Logger(ChainIndexerService.name);
  private readonly abi = new Interface(vaultAbi);
  private running = false;
  private warned = false;
  constructor(
    @InjectRepository(ChainCursor)
    private readonly cursors: Repository<ChainCursor>,
    @Inject(forwardRef(() => PaymentService))
    private readonly payments: PaymentService,
    @Inject(CHAIN_PROVIDER) private readonly provider: JsonRpcProvider,
    @Inject(CHAIN_CONFIG) private readonly config: ChainConfig,
  ) {}
  @Interval(4000)
  async poll(): Promise<void> {
    if (!this.config.vaultAddress || this.config.deployBlock === null) {
      if (!this.warned) {
        this.logger.warn(
          'Chain indexer disabled: vault configuration is missing',
        );
        this.warned = true;
      }
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.pollOnce();
    } catch {
      this.logger.error('Chain indexer poll failed');
    } finally {
      this.running = false;
    }
  }
  async pollOnce(): Promise<void> {
    if (!this.config.vaultAddress || this.config.deployBlock === null) return;
    const cursor = await this.cursors.findOneBy({ id: 'vault' });
    const from = cursor ? cursor.block + 1 : this.config.deployBlock;
    const to = Math.min(
      (await this.provider.getBlockNumber()) - 2,
      from + 1999,
    );
    if (to < from) return;
    const logs = await this.provider.getLogs({
      address: this.config.vaultAddress,
      fromBlock: from,
      toBlock: to,
      topics: [
        [
          this.abi.getEvent('Deposited')!.topicHash,
          this.abi.getEvent('Withdrawn')!.topicHash,
        ],
      ],
    });
    for (const log of logs) {
      const parsed = this.abi.parseLog(log);
      if (!parsed) throw new Error('Unrecognized vault log');
      const player = getAddress(String(parsed.args.player));
      const amount = formatUnits(parsed.args.amount, 6);
      if (parsed.name === 'Deposited')
        await this.payments.handleDeposit(
          player,
          amount,
          log.transactionHash,
          log.index,
        );
      else {
        const nonce = String(parsed.args.nonce);
        try {
          await this.payments.handleWithdrawn(
            player,
            amount,
            nonce,
            log.transactionHash,
            log.index,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'No matching withdrawal session'
          )
            this.logger.error(
              `Unmatched withdrawal txHash=${log.transactionHash} logIndex=${log.index} player=${player} nonce=${nonce}`,
            );
          throw error;
        }
      }
    }
    const block = await this.provider.getBlock(to);
    if (!block) throw new Error('Confirmed block unavailable');
    await this.cursors.save({
      id: 'vault',
      block: to,
      timestamp: block.timestamp,
    });
  }
  async confirmedTimestamp(): Promise<number | null> {
    if (!this.config.vaultAddress || this.config.deployBlock === null)
      return null;
    return (await this.cursors.findOneBy({ id: 'vault' }))?.timestamp ?? null;
  }
}
