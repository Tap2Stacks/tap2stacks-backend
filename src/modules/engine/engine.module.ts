import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocketModule } from '../socket/socket.module';
import { EngineClientService } from './engine-client.service';
import {
    CELL_SIGNER_KEY_TOKEN,
    ENGINE_CLIENT_OPTIONS,
} from './engine.types';
import { ExposurePublisher } from './exposure.publisher';
import { FeedHealthStore } from './feed-health.store';
import { GridPublisherService } from './grid-publisher.service';
import { LatestQuoteStore } from './latest-quote.store';
import { PriceSample } from './price-sample.entity';

@Module({
    imports: [TypeOrmModule.forFeature([PriceSample]), forwardRef(() => SocketModule)],
    providers: [
        LatestQuoteStore,
        FeedHealthStore,
        ExposurePublisher,
        GridPublisherService,
        EngineClientService,
        {
            provide: CELL_SIGNER_KEY_TOKEN,
            useFactory: () => process.env.CELL_SIGNER_KEY ?? '',
        },
        {
            provide: ENGINE_CLIENT_OPTIONS,
            useFactory: () => ({
                url: process.env.ENGINE_URL ?? '',
                token: process.env.ENGINE_TOKEN ?? '',
            }),
        },
    ],
    exports: [
        TypeOrmModule,
        LatestQuoteStore,
        FeedHealthStore,
        ExposurePublisher,
        GridPublisherService,
        EngineClientService,
    ],
})
export class EngineModule {}
