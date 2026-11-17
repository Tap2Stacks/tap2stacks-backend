import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../order/entities/order.entity';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { ProofCronService } from './proof-cron.service';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { MerkleTreeService } from './merkle-tree.service';
import { HCS_PUBLISHER } from './publishers/hcs-publisher';
import { MockHcsPublisher } from './publishers/mock-hcs.publisher';

@Module({
  imports: [TypeOrmModule.forFeature([Order, SettlementAnchorBatch])],
  providers: [
    ProofService,
    ProofCronService,
    MerkleTreeService,
    MockHcsPublisher,
    {
      provide: HCS_PUBLISHER,
      useExisting: MockHcsPublisher,
    },
  ],
  controllers: [ProofController],
  exports: [ProofService, MerkleTreeService, TypeOrmModule],
})
export class ProofModule {}
