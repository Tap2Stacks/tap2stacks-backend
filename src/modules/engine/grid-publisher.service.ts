import { Inject, Injectable, Optional } from '@nestjs/common';
import { centsToPrice, RemoteCell, signCell } from 'src/libs/cell';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import { CELL_SIGNER_KEY_TOKEN, EngineQuote } from './engine.types';

@Injectable()
export class GridPublisherService {
    constructor(
        @Inject(EVENT_PUBLISHER)
        private readonly events: EventPublisher,
        @Optional()
        @Inject(CELL_SIGNER_KEY_TOKEN)
        private readonly cellSignerKey?: string,
    ) {}

    private getSignerKey(): string {
        return this.cellSignerKey ?? process.env.CELL_SIGNER_KEY ?? '';
    }

    publish(quote: EngineQuote): void {
        const key = this.getSignerKey();
        const priceStep = centsToPrice(quote.bandCents);

        const cells: RemoteCell[] = quote.cells.map((cell) => {
            const unsigned = {
                ticker: quote.ticker,
                gridTs: quote.serverTsMs,
                startTs: cell.windowStartMs,
                endTs: cell.windowEndMs,
                lowerPrice: centsToPrice(cell.lowerCents),
                upperPrice: centsToPrice(cell.upperCents),
                rewardRate: cell.multiplier.toFixed(4),
            };
            return {
                ...unsigned,
                gridSignature: signCell(unsigned, key),
            };
        });

        void this.events.emitGridUpdate({
            ticker: quote.ticker,
            gridTs: quote.serverTsMs,
            priceStep,
            cells,
        });
    }
}
