import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRedis, RedisModule } from '@nestjs-modules/ioredis';
import { env } from 'src/config';
import Redis from 'ioredis';
import dataSource from 'src/libs/typeorm.config';
import { HealthCheckModule } from './health-check/health-check.module';
import { AccountModule } from './account/account.module';
import { AuthModule } from './auth/auth.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';
import { SocketModule } from './socket/socket.module';
import { ProofModule } from './proof/proof.module';
import { PricesModule } from './prices/prices.module';
import { FeedModule } from './feed/feed.module';
import { PaymasterModule } from './paymaster/paymaster.module';
import { SessionModule } from './session/session.module';
import { GeofenceMiddleware } from './player/geofence.middleware';
import { PlayerModule } from './player/player.module';
import { EngineModule } from './engine/engine.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
    TypeOrmModule.forRoot(dataSource.options),
    RedisModule.forRoot({
      type: 'single',
      url: env.redis.url,
      options: {},
    }),
    HealthCheckModule,
    AuthModule,
    SocketModule,
    AccountModule,
    OrderModule,
    PaymentModule,
    ProofModule,
    EngineModule,
    FeedModule,
    PlayerModule,
    SessionModule,
    PaymasterModule,
    PricesModule,
  ],
})
export class AppModule implements OnModuleInit, NestModule {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(GeofenceMiddleware).forRoutes('*');
  }
  async onModuleInit() {}
}
