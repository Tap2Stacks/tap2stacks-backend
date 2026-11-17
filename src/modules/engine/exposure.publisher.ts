import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import {
    EngineExposureMessage,
    EXPOSURE_DEBOUNCE_MS,
    ExposureCell,
} from './engine.types';

@Injectable()
export class ExposurePublisher implements OnModuleDestroy {
    private readonly pending = new Map<string, ExposureCell[]>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private sender?: (msg: EngineExposureMessage) => void;
    private readonly debounceMs: number;

    constructor(
        @Optional()
        @Inject(EXPOSURE_DEBOUNCE_MS)
        debounceMs?: number,
    ) {
        this.debounceMs = debounceMs ?? 100;
    }

    setSender(sender: (msg: EngineExposureMessage) => void): void {
        this.sender = sender;
    }

    sendExposure(ticker: string, cells: ExposureCell[]): void {
        this.pending.set(ticker, cells);
        if (this.timers.has(ticker)) {
            return;
        }

        const timer = setTimeout(() => {
            this.timers.delete(ticker);
            const latest = this.pending.get(ticker);
            this.pending.delete(ticker);
            if (latest !== undefined && this.sender) {
                this.sender({
                    type: 'exposure',
                    ticker,
                    cells: latest,
                });
            }
        }, this.debounceMs);
        this.timers.set(ticker, timer);
    }

    onModuleDestroy(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.pending.clear();
    }
}
