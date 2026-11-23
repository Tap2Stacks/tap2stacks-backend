import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { Repository } from 'typeorm';
import { WebSocket } from 'ws';
import { EVENT_PUBLISHER, EventPublisher } from '../socket/types';
import {
  ENGINE_CLIENT_OPTIONS,
  EngineClientOptions,
  EngineExposureMessage,
  EngineHealth,
  EngineInboundMessage,
  EngineSample,
  ExposureCell,
} from './engine.types';
import { ExposurePublisher } from './exposure.publisher';
import { FeedHealthStore } from './feed-health.store';
import { GridPublisherService } from './grid-publisher.service';
import { LatestQuoteStore } from './latest-quote.store';
import { PriceSample } from './price-sample.entity';

const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

@Injectable()
export class EngineClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineClientService.name);
  readonly sample$ = new Subject<EngineSample>();
  readonly health$ = new Subject<EngineHealth>();

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private readonly loggedSampleTickers = new Set<string>();

  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly urlOverride?: string;
  private readonly tokenOverride?: string;

  constructor(
    private readonly latestQuoteStore: LatestQuoteStore,
    private readonly feedHealthStore: FeedHealthStore,
    private readonly exposurePublisher: ExposurePublisher,
    private readonly gridPublisher: GridPublisherService,
    @InjectRepository(PriceSample)
    private readonly priceSampleRepo: Repository<PriceSample>,
    @Inject(EVENT_PUBLISHER)
    private readonly events: EventPublisher,
    @Optional()
    @Inject(ENGINE_CLIENT_OPTIONS)
    options?: EngineClientOptions,
  ) {
    this.urlOverride = options?.url;
    this.tokenOverride = options?.token;
    this.initialBackoffMs =
      options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

    this.exposurePublisher.setSender((msg) => this.sendExposureFrame(msg));
  }

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.disconnect();
    this.sample$.complete();
    this.health$.complete();
  }

  getBackoffDelayMs(attempt: number): number {
    const exp = Math.max(0, attempt);
    return Math.min(
      this.maxBackoffMs,
      this.initialBackoffMs * Math.pow(2, exp),
    );
  }

  connect(): void {
    const rawUrl = this.urlOverride ?? process.env.ENGINE_URL ?? '';
    const token = this.tokenOverride ?? process.env.ENGINE_TOKEN ?? '';

    if (!rawUrl) {
      this.logger.warn('ENGINE_URL is not set; engine client disabled');
      return;
    }

    this.stopped = false;
    this.clearReconnectTimer();
    this.openSocket(this.normalizeWsUrl(rawUrl), token);
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.removeAllListeners();
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.terminate();
      }
    }
  }

  sendExposure(ticker: string, cells: ExposureCell[]): void {
    this.exposurePublisher.sendExposure(ticker, cells);
  }

  private normalizeWsUrl(url: string): string {
    if (url.startsWith('http://')) {
      return `ws://${url.slice('http://'.length)}`;
    }
    if (url.startsWith('https://')) {
      return `wss://${url.slice('https://'.length)}`;
    }
    return url;
  }

  private openSocket(url: string, token: string): void {
    if (this.stopped) {
      return;
    }

    const socket = new WebSocket(url, {
      headers: {
        'x-engine-token': token,
      },
    });
    this.ws = socket;

    socket.on('open', () => {
      if (this.ws !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.feedHealthStore.markConnected(Date.now());
      this.logger.log(`Connected to engine at ${url}`);
    });

    socket.on('message', (data) => {
      if (this.ws !== socket) {
        return;
      }
      void this.handleRawMessage(data.toString());
    });

    socket.on('error', (err) => {
      if (this.ws !== socket) {
        return;
      }
      this.logger.warn(`Engine socket error: ${err.message}`);
    });

    socket.on('close', (code) => {
      if (this.ws !== socket) {
        return;
      }
      this.ws = null;
      const flippedTickers = this.feedHealthStore.markDisconnected(Date.now());
      for (const ticker of flippedTickers) {
        void this.events.emitFeedHealth?.({
          ticker,
          stale: true,
          prevDayPx: this.feedHealthStore.prevDayPx(ticker),
        });
      }

      if (!this.stopped) {
        const delayMs = this.getBackoffDelayMs(this.reconnectAttempt);
        this.reconnectAttempt += 1;
        this.logger.warn(
          `Engine socket closed (code=${code}); reconnecting in ${delayMs}ms`,
        );
        this.scheduleReconnect(url, token, delayMs);
      }
    });
  }

  private scheduleReconnect(url: string, token: string, delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket(url, token);
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendExposureFrame(msg: EngineExposureMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let msg: EngineInboundMessage;
    try {
      msg = JSON.parse(raw) as EngineInboundMessage;
    } catch {
      this.logger.warn('Ignoring invalid JSON frame from engine');
      return;
    }

    if (!msg || typeof msg !== 'object') {
      return;
    }

    switch (msg.type) {
      case 'quote':
        this.latestQuoteStore.set(msg);
        this.gridPublisher.publish(msg);
        break;

      case 'sample':
        await this.handleSample(msg);
        break;

      case 'health':
        await this.handleHealth(msg);
        break;

      default:
        break;
    }
  }

  private async handleSample(sample: EngineSample): Promise<void> {
    if (!this.loggedSampleTickers.has(sample.ticker)) {
      this.loggedSampleTickers.add(sample.ticker);
      this.logger.log(
        `live sample ${sample.ticker} tsMs=${sample.tsMs} price=${sample.price}`,
      );
    }
    try {
      await this.priceSampleRepo.save({
        ticker: sample.ticker,
        tsMs: sample.tsMs,
        price: String(sample.price),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to save price sample ${sample.ticker}@${sample.tsMs}: ${message}`,
      );
    }

    await this.events.emitPriceNow?.({
      ticker: sample.ticker,
      price: Number(sample.price).toFixed(2),
      ts: sample.tsMs,
    });
    this.sample$.next(sample);
  }

  private async handleHealth(health: EngineHealth): Promise<void> {
    const { changed, stale } = this.feedHealthStore.updateHealth(health);
    if (changed) {
      await this.events.emitFeedHealth?.({
        ticker: health.ticker,
        stale,
        prevDayPx: this.feedHealthStore.prevDayPx(health.ticker),
      });
    }
    this.health$.next(health);
  }
}
