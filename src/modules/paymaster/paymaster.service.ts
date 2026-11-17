import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { Interface } from 'ethers';
import { Address, Hex, getAddress, isAddress, isHex } from 'viem';
import {
  COINBASE_SMART_WALLET_FACTORIES,
  COINBASE_SMART_WALLET_IMPLEMENTATIONS,
  COINBASE_SMART_WALLET_PROXY_BYTECODE,
  COINBASE_SMART_WALLET_SENDER_CACHE_TTL_MS,
  ERC1967_IMPLEMENTATION_SLOT,
  PAYMASTER_DAILY_OPS_LIMIT,
} from './coinbase-smart-wallet.constants';

export const PAYMASTER_CONFIG = Symbol('PAYMASTER_CONFIG');
export const PAYMASTER_HTTP = Symbol('PAYMASTER_HTTP');
export const PAYMASTER_RPC = Symbol('PAYMASTER_RPC');

type Config = { url: string; addresses: string[] };

export interface SmartWalletRpcClient {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  getStorageAt(args: { address: Address; slot: Hex }): Promise<Hex | undefined>;
}

interface ParsedRequest {
  sender: Address;
  userOp: Record<string, unknown>;
  callData: string;
}

const SUPPORTED_METHODS = new Set([
  'pm_getPaymasterStubData',
  'pm_getPaymasterData',
]);

const accountInterface = new Interface([
  'function execute(address target,uint256 value,bytes data)',
  'function executeBatch((address target,uint256 value,bytes data)[] calls)',
]);

@Injectable()
export class PaymasterService {
  private readonly logger = new Logger(PaymasterService.name);
  private readonly verifiedSenders = new Map<Address, number>();
  // In-memory single-instance UTC daily sponsorship counter per player.
  private readonly dailyOpsByPlayer = new Map<
    Address,
    { day: string; count: number }
  >();

  constructor(
    @Inject(PAYMASTER_CONFIG) private readonly config: Config,
    @Inject(PAYMASTER_HTTP) private readonly http: AxiosInstance,
    @Inject(PAYMASTER_RPC) private readonly rpc: SmartWalletRpcClient,
  ) {}

  async forward(
    body: unknown,
    authenticatedAddress?: string,
  ): Promise<unknown> {
    this.assertConfigured();
    const authedSender = this.parseAuthenticatedAddress(authenticatedAddress);
    const parsed = this.parseRequest(body);
    if (parsed.sender !== authedSender) {
      throw new ForbiddenException(
        'Paymaster sender does not match authenticated wallet',
      );
    }

    await this.validateSmartWalletSender(parsed.sender, parsed.userOp);
    this.validateCallData(parsed.callData);
    this.consumeDailyQuota(parsed.sender);
    return this.forwardUpstream(body);
  }

  private assertConfigured(): void {
    if (
      !this.config.url ||
      this.config.addresses.length !== 3 ||
      this.config.addresses.some(
        (address) => !isAddress(address, { strict: false }),
      )
    ) {
      throw new ServiceUnavailableException('Paymaster not available yet');
    }
  }

  private parseAuthenticatedAddress(raw?: string): Address {
    if (!raw || !isAddress(raw, { strict: false })) {
      throw new UnauthorizedException('Invalid authenticated wallet');
    }
    return getAddress(raw);
  }

  private parseRequest(input: unknown): ParsedRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Invalid JSON-RPC request');
    }
    const body = input as Record<string, unknown>;
    const firstParam = Array.isArray(body.params) ? body.params[0] : null;
    if (
      body.jsonrpc !== '2.0' ||
      (typeof body.id !== 'string' && typeof body.id !== 'number') ||
      typeof body.method !== 'string' ||
      !SUPPORTED_METHODS.has(body.method) ||
      !firstParam ||
      typeof firstParam !== 'object' ||
      Array.isArray(firstParam)
    ) {
      throw new BadRequestException('Invalid paymaster request');
    }

    const userOp = firstParam as Record<string, unknown>;
    if (
      typeof userOp.sender !== 'string' ||
      !isAddress(userOp.sender, { strict: false }) ||
      typeof userOp.callData !== 'string'
    ) {
      throw new BadRequestException('Invalid paymaster request');
    }

    return {
      sender: getAddress(userOp.sender),
      userOp,
      callData: userOp.callData,
    };
  }

  private async validateSmartWalletSender(
    sender: Address,
    userOp: Record<string, unknown>,
  ): Promise<void> {
    const factory = this.extractOptionalFactory(userOp);
    const now = Date.now();
    const cachedExpiresAt = this.verifiedSenders.get(sender);
    if (cachedExpiresAt !== undefined && cachedExpiresAt > now) {
      if (factory && !COINBASE_SMART_WALLET_FACTORIES.has(factory)) {
        throw new BadRequestException('Unsupported smart wallet factory');
      }
      return;
    }
    this.verifiedSenders.delete(sender);

    const code = await this.readCode(sender);
    if (!code || code === '0x') {
      if (!factory || !COINBASE_SMART_WALLET_FACTORIES.has(factory)) {
        throw new BadRequestException('Unsupported smart wallet factory');
      }
      return;
    }

    if (code.toLowerCase() !== COINBASE_SMART_WALLET_PROXY_BYTECODE) {
      throw new BadRequestException('Sender is not a Coinbase Smart Wallet');
    }
    if (factory && !COINBASE_SMART_WALLET_FACTORIES.has(factory)) {
      throw new BadRequestException('Unsupported smart wallet factory');
    }

    const impl = await this.readImplementationAddress(sender);
    if (!impl || !COINBASE_SMART_WALLET_IMPLEMENTATIONS.has(impl)) {
      throw new BadRequestException(
        'Unsupported Coinbase Smart Wallet implementation',
      );
    }

    this.cacheVerifiedSender(sender, now);
  }

  private extractOptionalFactory(
    userOp: Record<string, unknown>,
  ): Address | null {
    const { initCode, factory } = userOp;
    if (initCode !== undefined && typeof initCode !== 'string') {
      throw new BadRequestException('Invalid initCode');
    }
    if (factory !== undefined && typeof factory !== 'string') {
      throw new BadRequestException('Invalid factory');
    }

    let fromInitCode: Address | null = null;
    if (typeof initCode === 'string' && initCode !== '' && initCode !== '0x') {
      if (
        !isHex(initCode, { strict: true }) ||
        initCode.length < 42 ||
        initCode.length % 2 !== 0
      ) {
        throw new BadRequestException('Invalid initCode');
      }
      fromInitCode = getAddress(initCode.slice(0, 42));
    }

    let fromField: Address | null = null;
    if (typeof factory === 'string' && factory !== '') {
      if (!isAddress(factory, { strict: false })) {
        throw new BadRequestException('Invalid factory');
      }
      fromField = getAddress(factory);
    }

    if (fromInitCode && fromField && fromInitCode !== fromField) {
      throw new BadRequestException('Mismatched initCode and factory');
    }
    return fromInitCode ?? fromField;
  }

  private async readCode(sender: Address): Promise<Hex | undefined> {
    try {
      return await this.rpc.getCode({ address: sender });
    } catch {
      this.logger.warn('Smart wallet code RPC verification failed');
      throw new ServiceUnavailableException(
        'Smart wallet verification unavailable',
      );
    }
  }

  private async readImplementationAddress(
    sender: Address,
  ): Promise<Address | null> {
    let slotValue: Hex | undefined;
    try {
      slotValue = await this.rpc.getStorageAt({
        address: sender,
        slot: ERC1967_IMPLEMENTATION_SLOT,
      });
    } catch {
      this.logger.warn('Smart wallet implementation RPC verification failed');
      throw new ServiceUnavailableException(
        'Smart wallet verification unavailable',
      );
    }

    if (
      !slotValue ||
      !isHex(slotValue, { strict: true }) ||
      slotValue.length !== 66 ||
      slotValue.slice(2, 26) !== '0'.repeat(24)
    ) {
      return null;
    }
    return getAddress(`0x${slotValue.slice(26)}`);
  }

  private cacheVerifiedSender(sender: Address, now: number): void {
    if (this.verifiedSenders.size > 1000) {
      for (const [key, expiresAt] of this.verifiedSenders) {
        if (expiresAt <= now) this.verifiedSenders.delete(key);
      }
    }
    this.verifiedSenders.set(
      sender,
      now + COINBASE_SMART_WALLET_SENDER_CACHE_TTL_MS,
    );
  }

  private validateCallData(callData: string): void {
    let targets: string[];
    try {
      const parsed = accountInterface.parseTransaction({ data: callData });
      if (parsed?.name === 'execute') {
        targets = [parsed.args.target];
      } else if (parsed?.name === 'executeBatch') {
        targets = Array.from(parsed.args.calls, (call: any) => call.target);
      } else {
        throw new Error('Unknown call');
      }
    } catch {
      throw new BadRequestException('Unsupported account callData');
    }

    const allowed = new Set(
      this.config.addresses.map((address) => getAddress(address).toLowerCase()),
    );
    if (
      !targets.length ||
      targets.some(
        (target) =>
          !isAddress(target, { strict: false }) ||
          !allowed.has(getAddress(target).toLowerCase()),
      )
    ) {
      throw new BadRequestException('Unsupported target');
    }
  }

  private consumeDailyQuota(sender: Address): void {
    const today = new Date().toISOString().slice(0, 10);
    const current = this.dailyOpsByPlayer.get(sender);
    const count = current?.day === today ? current.count : 0;
    if (count >= PAYMASTER_DAILY_OPS_LIMIT) {
      throw new HttpException(
        'Daily sponsored operation limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (this.dailyOpsByPlayer.size > 1000) {
      for (const [key, entry] of this.dailyOpsByPlayer) {
        if (entry.day !== today) this.dailyOpsByPlayer.delete(key);
      }
    }
    this.dailyOpsByPlayer.set(sender, { day: today, count: count + 1 });
  }

  private async forwardUpstream(body: unknown): Promise<unknown> {
    try {
      const response = await this.http.post(this.config.url, body, {
        maxRedirects: 0,
        timeout: 10000,
      });
      const serialized = JSON.stringify(response.data ?? null);
      if (serialized.includes(this.config.url)) {
        throw new Error('Unsafe upstream response');
      }
      return response.data;
    } catch {
      throw new BadGatewayException('Paymaster upstream unavailable');
    }
  }
}
