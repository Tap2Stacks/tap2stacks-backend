import { Injectable } from '@nestjs/common';
import { EngineHealth } from './engine.types';

interface TickerHealthState {
    lastReportedStale: boolean;
    openStaleFromMs: number | null;
    intervals: Array<[number, number]>;
}

@Injectable()
export class FeedHealthStore {
    private connected = false;
    private disconnectedSinceMs: number | null = null;
    private readonly disconnectIntervals: Array<[number, number]> = [];
    private readonly tickerStates = new Map<string, TickerHealthState>();
    private readonly lastEmittedStale = new Map<string, boolean>();

    markConnected(tsMs: number = Date.now()): void {
        if (this.disconnectedSinceMs !== null) {
            this.disconnectIntervals.push([
                this.disconnectedSinceMs,
                Math.max(this.disconnectedSinceMs, tsMs),
            ]);
            this.disconnectedSinceMs = null;
        }
        this.connected = true;
    }

    /**
     * Marks the engine connection as down and returns tickers whose effective
     * stale status flipped to true.
     */
    markDisconnected(tsMs: number = Date.now()): string[] {
        if (this.disconnectedSinceMs === null) {
            this.disconnectedSinceMs = tsMs;
        }
        this.connected = false;

        const flipped: string[] = [];
        for (const ticker of this.tickerStates.keys()) {
            if (this.lastEmittedStale.get(ticker) !== true) {
                this.lastEmittedStale.set(ticker, true);
                flipped.push(ticker);
            }
        }
        return flipped;
    }

    updateHealth(health: EngineHealth): { changed: boolean; stale: boolean } {
        let state = this.tickerStates.get(health.ticker);
        if (!state) {
            state = {
                lastReportedStale: health.stale,
                openStaleFromMs: health.stale ? health.serverTsMs : null,
                intervals: [],
            };
            this.tickerStates.set(health.ticker, state);
        } else {
            state.lastReportedStale = health.stale;
            if (health.stale && state.openStaleFromMs === null) {
                state.openStaleFromMs = health.serverTsMs;
            } else if (!health.stale && state.openStaleFromMs !== null) {
                state.intervals.push([
                    state.openStaleFromMs,
                    Math.max(state.openStaleFromMs, health.serverTsMs),
                ]);
                state.openStaleFromMs = null;
            }
        }

        const effectiveStale = !this.connected || health.stale;
        const prev = this.lastEmittedStale.get(health.ticker);
        const changed = prev !== effectiveStale;
        this.lastEmittedStale.set(health.ticker, effectiveStale);

        return { changed, stale: effectiveStale };
    }

    isStale(ticker: string): boolean {
        if (!this.connected) {
            return true;
        }
        return this.tickerStates.get(ticker)?.lastReportedStale ?? false;
    }

    staleIntervals(
        ticker: string,
        nowMs: number = Date.now(),
    ): Array<[number, number]> {
        const raw: Array<[number, number]> = [...this.disconnectIntervals];
        if (this.disconnectedSinceMs !== null) {
            raw.push([
                this.disconnectedSinceMs,
                Math.max(this.disconnectedSinceMs, nowMs),
            ]);
        }

        const state = this.tickerStates.get(ticker);
        if (state) {
            raw.push(...state.intervals);
            if (state.openStaleFromMs !== null) {
                raw.push([
                    state.openStaleFromMs,
                    Math.max(state.openStaleFromMs, nowMs),
                ]);
            }
        }

        if (raw.length <= 1) {
            return raw.map(([from, to]) => [from, to]);
        }

        raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const merged: Array<[number, number]> = [[raw[0][0], raw[0][1]]];
        for (let i = 1; i < raw.length; i++) {
            const [from, to] = raw[i];
            const last = merged[merged.length - 1];
            if (from <= last[1]) {
                last[1] = Math.max(last[1], to);
            } else {
                merged.push([from, to]);
            }
        }
        return merged;
    }
}
