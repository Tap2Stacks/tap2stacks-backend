import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { formatUnits, getAddress, isAddress, parseUnits } from 'ethers';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { AccountService } from '../account/account.service';
import { EconomicEventType } from '../account/types';
import { ChainIndexerService } from '../chain/chain-indexer.service';
import { WithdrawSignerService } from '../chain/withdraw-signer.service';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import {
  WithdrawalSession,
  WithdrawalStatus,
} from './entities/withdrawal-session.entity';

// Withdrawal recovery assumes a single backend instance.
@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);
  private readonly preparing = new Set<string>();
  constructor(
    private readonly accountService: AccountService,
    private readonly signer: WithdrawSignerService,
    @InjectRepository(DepositHistory)
    private readonly depositRepo: Repository<DepositHistory>,
    @InjectRepository(WithdrawalHistory)
    private readonly withdrawalHistoryRepo: Repository<WithdrawalHistory>,
    @InjectRepository(WithdrawalSession)
    private readonly withdrawalSessionRepo: Repository<WithdrawalSession>,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(forwardRef(() => ChainIndexerService))
    private readonly indexer: ChainIndexerService,
    @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcilePending();
  }
  async handleDeposit(
    userId: string,
    amount: string,
    txHash: string,
    logIndex: number,
  ) {
    userId = getAddress(userId);
    const existing = await this.depositRepo.findOne({
      where: { txHash, logIndex },
    });
    if (existing) return existing;
    await this.accountService.deposit(userId, amount, txHash, logIndex);
    const record = this.depositRepo.create({
      userId,
      amount,
      txHash,
      logIndex,
    });
    try {
      const saved = await this.depositRepo.save(record);
      await this.events.emitDepositSuccess({
        userId,
        amount,
        txHash,
        logIndex,
        timestamp: Date.now(),
      });
      return saved;
    } catch (error: any) {
      if (error.code === '23505')
        return this.depositRepo.findOne({ where: { txHash, logIndex } });
      throw error;
    }
  }
  async requestWithdrawal(rawUserId: string, amount: string) {
    if (!this.signer.available())
      throw new ServiceUnavailableException(
        'Withdrawals are not available yet',
      );
    if (!isAddress(rawUserId))
      throw new BadRequestException('Invalid player address');
    const userId = getAddress(rawUserId);
    const existing = await this.withdrawalSessionRepo.findOne({
      where: {
        userId,
        status: In([WithdrawalStatus.PENDING, WithdrawalStatus.OPEN]),
      },
    });
    if (existing?.status === WithdrawalStatus.OPEN)
      return this.permit(existing);
    if (existing) throw new ConflictException('Withdrawal is being prepared');
    if (
      typeof amount !== 'string' ||
      !/^\d+(?:\.\d{1,6})?$/.test(amount) ||
      parseUnits(amount, 6) <= 0n
    )
      throw new BadRequestException('Invalid withdrawal amount');
    const nonce = await this.signer.nonce(userId);
    const session = this.withdrawalSessionRepo.create({
      sessionId: uuidv7(),
      userId,
      amount: formatUnits(parseUnits(amount, 6), 6),
      nonce: String(nonce),
      status: WithdrawalStatus.PENDING,
      expiresAt: new Date((Math.floor(Date.now() / 1000) + 900) * 1000),
    });
    this.preparing.add(session.sessionId);
    try {
      try {
        await this.withdrawalSessionRepo.save(session);
      } catch (error: any) {
        if (error.code === '23505')
          throw new ConflictException('Withdrawal is being prepared');
        throw error;
      }
      try {
        await this.accountService.withdrawRequested(
          userId,
          session.amount,
          session.sessionId,
        );
      } catch (error) {
        const locked = await this.accountService.hasEconomicEvent(
          userId,
          EconomicEventType.WITHDRAW_REQUESTED,
          session.sessionId,
        );
        if (!locked)
          await this.withdrawalSessionRepo.update(
            { sessionId: session.sessionId },
            { status: WithdrawalStatus.FAILED },
          );
        throw error;
      }
      return await this.openPending(session);
    } finally {
      this.preparing.delete(session.sessionId);
    }
  }
  private async openPending(session: WithdrawalSession) {
    const deadline = Math.floor(session.expiresAt.getTime() / 1000);
    const signature = await this.signer.sign(
      session.userId,
      parseUnits(session.amount, 6),
      BigInt(session.nonce!),
      deadline,
    );
    const opened = {
      ...session,
      status: WithdrawalStatus.OPEN,
      approvalSignature: signature,
    };
    await this.withdrawalSessionRepo.save(opened);
    await this.events.emitWithdrawQueued({
      sessionId: session.sessionId,
      userId: session.userId,
      amount: session.amount,
      timestamp: Date.now(),
    });
    return this.permit(opened);
  }
  private permit(session: WithdrawalSession) {
    if (!session.nonce || !session.approvalSignature)
      throw new ConflictException('Withdrawal permit unavailable');
    return {
      sessionId: session.sessionId,
      amountBase: parseUnits(session.amount, 6).toString(),
      nonce: session.nonce,
      deadline: Math.floor(session.expiresAt.getTime() / 1000),
      signature: session.approvalSignature,
      vault: this.signer.vault,
    };
  }
  async finalizeWithdrawal(
    sessionId: string,
    txHash: string,
    logIndex: number,
  ) {
    const session = await this.withdrawalSessionRepo.findOne({
      where: { sessionId },
    });
    if (!session?.nonce)
      throw new NotFoundException('Withdrawal session not found');
    return this.handleWithdrawn(
      session.userId,
      session.amount,
      session.nonce,
      txHash,
      logIndex,
    );
  }
  async handleWithdrawn(
    userId: string,
    amount: string,
    nonce: string,
    txHash: string,
    logIndex: number,
  ) {
    userId = getAddress(userId);
    const existing = await this.withdrawalHistoryRepo.findOne({
      where: { txHash, logIndex },
    });
    if (existing) return existing;
    const session = await this.withdrawalSessionRepo.findOne({
      where: {
        userId,
        nonce,
        status: In([WithdrawalStatus.OPEN, WithdrawalStatus.SUCCESS]),
      },
    });
    if (!session || parseUnits(session.amount, 6) !== parseUnits(amount, 6))
      throw new Error('No matching withdrawal session');
    if (
      session.status === WithdrawalStatus.SUCCESS &&
      session.txHash !== txHash
    )
      throw new Error('Withdrawal transaction mismatch');
    await this.accountService.withdrawSucceeded(
      userId,
      session.amount,
      txHash,
      logIndex,
    );
    await this.withdrawalSessionRepo.save({
      ...session,
      status: WithdrawalStatus.SUCCESS,
      txHash,
    });
    const record = this.withdrawalHistoryRepo.create({
      sessionId: session.sessionId,
      userId,
      amount: session.amount,
      txHash,
      logIndex,
    });
    const saved = await this.withdrawalHistoryRepo.save(record);
    await this.events.emitWithdrawSuccess({
      userId,
      amount: session.amount,
      timestamp: Date.now(),
      txHash,
      logIndex,
    });
    return saved;
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async expireWithdrawals(): Promise<void> {
    await this.withRecoveryLock(async () => {
      const confirmed = await this.indexer.confirmedTimestamp();
      if (confirmed !== null) {
        const sessions = await this.withdrawalSessionRepo.find({
          where: { status: WithdrawalStatus.OPEN },
        });
        for (const session of sessions)
          if (confirmed > Math.floor(session.expiresAt.getTime() / 1000))
            await this.expireWithdrawal(session);
      }
      await this.reconcilePendingSessions(new Date(Date.now() - 120000));
    });
  }
  private async withRecoveryLock(work: () => Promise<void>): Promise<void> {
    const runner = this.dataSource!.createQueryRunner();
    let acquired = false;
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [873611902],
      );
      acquired = rows[0]?.acquired === true;
      if (acquired) await work();
    } finally {
      try {
        if (acquired)
          await runner.query('SELECT pg_advisory_unlock($1)', [873611902]);
      } finally {
        await runner.release();
      }
    }
  }
  private async expireWithdrawal(session: WithdrawalSession): Promise<void> {
    await this.accountService.withdrawCancelled(
      session.userId,
      session.amount,
      session.sessionId,
    );
    await this.withdrawalSessionRepo.save({
      ...session,
      status: WithdrawalStatus.EXPIRED,
    });
    await this.events.emitWithdrawCancelled({
      sessionId: session.sessionId,
      userId: session.userId,
      amount: session.amount,
      timestamp: Date.now(),
    });
  }
  async reconcilePending(): Promise<void> {
    await this.withRecoveryLock(() => this.reconcilePendingSessions());
  }
  private async reconcilePendingSessions(olderThan?: Date): Promise<void> {
    const sessions = await this.withdrawalSessionRepo.find({
      where: {
        status: WithdrawalStatus.PENDING,
        ...(olderThan ? { createdAt: LessThan(olderThan) } : {}),
      },
    });
    const confirmed = await this.indexer.confirmedTimestamp();
    for (const session of sessions) {
      if (this.preparing.has(session.sessionId)) continue;
      const locked = await this.accountService.hasEconomicEvent(
        session.userId,
        EconomicEventType.WITHDRAW_REQUESTED,
        session.sessionId,
      );
      if (!locked) {
        await this.withdrawalSessionRepo.save({
          ...session,
          status: WithdrawalStatus.FAILED,
        });
        continue;
      }
      if (
        confirmed !== null &&
        confirmed > Math.floor(session.expiresAt.getTime() / 1000)
      )
        await this.expireWithdrawal(session);
      else if (this.signer.available()) await this.openPending(session);
      else
        this.logger.warn(
          'Pending withdrawal cannot be recovered until signer is configured',
        );
    }
  }
  async getUserDeposits(userId: string, limit = 20, offset = 0) {
    return this.depositRepo.find({
      where: { userId: getAddress(userId) },
      take: limit,
      skip: offset,
      order: { logIndex: 'DESC' },
    });
  }
  async getActiveWithdrawalSession(userId: string) {
    return this.withdrawalSessionRepo.findOne({
      where: { userId: getAddress(userId), status: WithdrawalStatus.OPEN },
    });
  }
  async getUserWithdrawals(
    userId: string,
    _status?: WithdrawalStatus,
    limit = 20,
    offset = 0,
  ) {
    return this.withdrawalHistoryRepo.find({
      where: { userId: getAddress(userId) },
      take: limit,
      skip: offset,
      order: { logIndex: 'DESC' },
    });
  }
}
