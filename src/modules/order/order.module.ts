import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountModule } from '../account/account.module';
import { EngineModule } from '../engine/engine.module';
import { CELL_SIGNER_KEY_TOKEN } from '../engine/engine.types';
import { PlayerModule } from '../player/player.module';
import { SocketModule } from '../socket/socket.module';
import { Order } from './entities/order.entity';
import { ExposureTracker } from './exposure.tracker';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderWorker } from './order.worker';
import { OrderPriceTickChannel } from './price-tick.channel';

@Module({
    imports: [
        forwardRef(() => AccountModule),
        TypeOrmModule.forFeature([Order]),
        forwardRef(() => SocketModule),
        forwardRef(() => EngineModule),
        PlayerModule,
    ],
    controllers: [OrderController],
    providers: [
        OrderService,
        OrderWorker,
        ExposureTracker,
        {
            provide: CELL_SIGNER_KEY_TOKEN,
            useFactory: () => process.env.CELL_SIGNER_KEY ?? '',
        },
        {
            provide: OrderPriceTickChannel,
            useValue: new OrderPriceTickChannel(),
        },
    ],
    exports: [OrderService, OrderWorker, ExposureTracker, OrderPriceTickChannel],
})
export class OrderModule {}
