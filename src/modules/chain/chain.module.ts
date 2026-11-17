import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JsonRpcProvider } from 'ethers';
import { env } from 'src/config';
import { PaymentModule } from '../payment/payment.module';
import { ChainCursor } from './chain-cursor.entity';
import {
  CHAIN_CONFIG,
  CHAIN_PROVIDER,
  ChainIndexerService,
} from './chain-indexer.service';
import {
  SIGNER_CONFIG,
  WithdrawSignerService,
} from './withdraw-signer.service';
@Module({
  imports: [
    TypeOrmModule.forFeature([ChainCursor]),
    forwardRef(() => PaymentModule),
  ],
  providers: [
    ChainIndexerService,
    WithdrawSignerService,
    {
      provide: CHAIN_PROVIDER,
      useFactory: () => new JsonRpcProvider(env.web3.rpcUrl, 84532),
    },
    {
      provide: CHAIN_CONFIG,
      useFactory: () => ({
        vaultAddress: env.web3.vaultAddress,
        deployBlock: env.web3.deployBlock,
      }),
    },
    {
      provide: SIGNER_CONFIG,
      useFactory: () => ({
        vaultAddress: env.web3.vaultAddress,
        signerKey: env.secret.withdrawSignerPrivateKey,
        deployBlock: env.web3.deployBlock,
      }),
    },
  ],
  exports: [ChainIndexerService, WithdrawSignerService],
})
export class ChainModule {}
