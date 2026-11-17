import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from 'src/config';
import { PriceSample } from '../engine/price-sample.entity';
import { FeedModule } from '../feed/feed.module';
import { Order } from '../order/entities/order.entity';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { MerkleTreeService } from './merkle-tree.service';
import { PriceLogService } from './price-log.service';
import { ProofCronService } from './proof-cron.service';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import {
  BASE_PROOF_PUBLISHER_CONFIG,
  BaseProofPublisher,
  PROOF_PUBLISHER,
} from './publishers/base-proof.publisher';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, SettlementAnchorBatch, PriceSample]),
    FeedModule,
  ],
  providers: [
    ProofService,
    ProofCronService,
    MerkleTreeService,
    PriceLogService,
    BaseProofPublisher,
    {
      provide: BASE_PROOF_PUBLISHER_CONFIG,
      useFactory: () => ({
        enabled: env.flag.proofAnchorEnabled,
        rpcUrl: env.web3.rpcUrl,
        contractAddress: env.web3.proofAnchorAddress,
        relayerPrivateKey: env.secret.relayerPrivateKey,
      }),
    },
    {
      provide: PROOF_PUBLISHER,
      useExisting: BaseProofPublisher,
    },
  ],
  controllers: [ProofController],
  exports: [ProofService, MerkleTreeService, PriceLogService, TypeOrmModule],
})
export class ProofModule {}
