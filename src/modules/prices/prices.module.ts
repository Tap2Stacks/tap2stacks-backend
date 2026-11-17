import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EngineModule } from '../engine/engine.module';
import { PriceSample } from '../engine/price-sample.entity';
import { FeedModule } from '../feed/feed.module';
import { PricesController } from './prices.controller';
@Module({
  imports: [TypeOrmModule.forFeature([PriceSample]), EngineModule, FeedModule],
  controllers: [PricesController],
})
export class PricesModule {}
