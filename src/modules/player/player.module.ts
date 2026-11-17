import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedModule } from '../feed/feed.module';
import { MetricsController, MetricsService } from './metrics.controller';
import { Player } from './player.entity';
import { PlayerService } from './player.service';
@Module({
  imports: [TypeOrmModule.forFeature([Player]), FeedModule],
  providers: [PlayerService, MetricsService],
  controllers: [MetricsController],
  exports: [PlayerService],
})
export class PlayerModule {}
