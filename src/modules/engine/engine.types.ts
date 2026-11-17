export interface EngineQuoteCell {
    windowStartMs: number;
    windowEndMs: number;
    lowerCents: number;
    upperCents: number;
    hitProbability: number;
    multiplier: number;
}

export interface EngineQuote {
    type?: 'quote';
    ticker: string;
    serverTsMs: number;
    spot: number;
    bandCents: number;
    cells: EngineQuoteCell[];
}

export interface EngineSample {
    type?: 'sample';
    ticker: string;
    tsMs: number;
    price: number;
}

export interface EngineHealth {
    type?: 'health';
    ticker: string;
    serverTsMs: number;
    lastSampleAgeMs: number | null;
    prevDayPx?: number | null;
    stale: boolean;
}

export type EngineInboundMessage =
    | (EngineQuote & { type: 'quote' })
    | (EngineSample & { type: 'sample' })
    | (EngineHealth & { type: 'health' });

export interface ExposureCell {
    windowStartMs: number;
    lowerCents: number;
    liability: number;
}

export interface EngineExposureMessage {
    type: 'exposure';
    ticker: string;
    cells: ExposureCell[];
}

export interface EngineClientOptions {
    url?: string;
    token?: string;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
}

export const ENGINE_CLIENT_OPTIONS = Symbol('ENGINE_CLIENT_OPTIONS');
export const CELL_SIGNER_KEY_TOKEN = Symbol('CELL_SIGNER_KEY_TOKEN');
export const EXPOSURE_DEBOUNCE_MS = Symbol('EXPOSURE_DEBOUNCE_MS');
