import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountModule } from '../account/account.module';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { ChainModule } from '../chain/chain.module';
import { WithdrawalSession } from './entities/withdrawal-session.entity';
import { DepositHistory } from './entities/deposit-history.entity';
import { WithdrawalHistory } from './entities/withdrawal-history.entity';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WithdrawalSession,
      DepositHistory,
      WithdrawalHistory,
    ]),
    AccountModule,
    SocketModule,
    forwardRef(() => ChainModule),
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
