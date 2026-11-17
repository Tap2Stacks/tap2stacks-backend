import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../order/entities/order.entity';
import { FeedController } from './feed.controller';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [FeedController],
  providers: [PublicRateLimitGuard],
  exports: [PublicRateLimitGuard],
})
export class FeedModule {}
