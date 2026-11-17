import { Injectable } from '@nestjs/common';
import { EngineQuote } from './engine.types';

@Injectable()
export class LatestQuoteStore {
    private readonly quotes = new Map<string, EngineQuote>();

    set(quote: EngineQuote): void {
        this.quotes.set(quote.ticker, quote);
    }

    get(ticker: string): EngineQuote | undefined {
        return this.quotes.get(ticker);
    }

    getAll(): EngineQuote[] {
        return Array.from(this.quotes.values());
    }
}
