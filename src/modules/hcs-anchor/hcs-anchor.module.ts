import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from 'src/config';
import { Order } from '../order/entities/order.entity';
import { SettlementAnchorBatch } from './entities/settlement-anchor-batch.entity';
import { HcsAnchorCronService } from './hcs-anchor-cron.service';
import { HcsAnchorController } from './hcs-anchor.controller';
import { HcsAnchorService } from './hcs-anchor.service';
import { MerkleTreeService } from './merkle-tree.service';
import { HCS_PUBLISHER } from './publishers/hcs-publisher';
import { LegacyHcsPublisher } from './publishers/legacy-hcs.publisher';
import { MockHcsPublisher } from './publishers/mock-hcs.publisher';

@Module({
  imports: [TypeOrmModule.forFeature([Order, SettlementAnchorBatch])],
  providers: [
    HcsAnchorService,
    HcsAnchorCronService,
    MerkleTreeService,
    MockHcsPublisher,
    LegacyHcsPublisher,
    {
      provide: HCS_PUBLISHER,
      inject: [MockHcsPublisher, LegacyHcsPublisher],
      useFactory: (
        mockPublisher: MockHcsPublisher,
        legacyPublisher: LegacyHcsPublisher,
      ) => (env.hcs.mode === 'legacy' ? legacyPublisher : mockPublisher),
    },
  ],
  controllers: [HcsAnchorController],
  exports: [HcsAnchorService, MerkleTreeService, TypeOrmModule],
})
export class HcsAnchorModule {}
