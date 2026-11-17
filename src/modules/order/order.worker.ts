import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { env } from 'src/config';
import { EngineClientService } from '../engine/engine-client.service';
import { OrderService } from './order.service';

const STALE_SWEEP_INTERVAL_MS = 1000;

@Injectable()
export class OrderWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(OrderWorker.name);
    private sampleSub: Subscription | null = null;
    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly engineClient: EngineClientService,
        private readonly orderService: OrderService,
    ) {}

    onModuleInit() {
        if (env.flag.runSettlement) {
            this.logger.log('OrderWorker started');
            this.sampleSub = this.engineClient.sample$.subscribe((sample) => {
                void this.orderService.handleSample(sample).catch((err) => {
                    this.logger.error('Sample settlement error', err);
                });
            });
            this.sweepTimer = setInterval(() => {
                void this.orderService.voidStaleOrders().catch((err) => {
                    this.logger.error('Stale order sweep error', err);
                });
            }, STALE_SWEEP_INTERVAL_MS);
        }
    }

    onModuleDestroy() {
        if (this.sampleSub) {
            this.sampleSub.unsubscribe();
            this.sampleSub = null;
        }
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
    }
}
