import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  isAddress,
} from 'ethers';
import { ProofPostResult } from '../types';

export const PROOF_PUBLISHER = Symbol('PROOF_PUBLISHER');
export const BASE_PROOF_PUBLISHER_CONFIG = Symbol(
  'BASE_PROOF_PUBLISHER_CONFIG',
);
// Optional override for tests; the app builds the ethers contract itself.
export const PROOF_ANCHOR_CONTRACT_FACTORY = Symbol(
  'PROOF_ANCHOR_CONTRACT_FACTORY',
);

export interface ProofPublisher {
  post(
    tapsRoot: string,
    priceLogHash: string,
    fromMs: number,
    toMs: number,
  ): Promise<ProofPostResult>;
}

export interface BaseProofPublisherConfig {
  enabled: boolean;
  rpcUrl: string;
  contractAddress: string;
  relayerPrivateKey: string;
}

export interface ProofAnchorContractLike {
  postRoot(
    tapsRoot: string,
    priceLogHash: string,
    fromMs: number,
    toMs: number,
  ): Promise<{
    hash: string;
    wait(): Promise<{
      hash?: string;
      logs?: Array<{
        address?: string;
        topics: readonly string[];
        data: string;
      }>;
    } | null>;
  }>;
}

const PROOF_ANCHOR_ABI = [
  'function postRoot(bytes32 tapsRoot, bytes32 priceLogHash, uint64 fromMs, uint64 toMs)',
  'event RootPosted(uint256 indexed index, bytes32 tapsRoot, bytes32 priceLogHash, uint64 fromMs, uint64 toMs)',
];

const proofAnchorInterface = new Interface(PROOF_ANCHOR_ABI);

@Injectable()
export class BaseProofPublisher implements ProofPublisher, OnModuleInit {
  private readonly logger = new Logger(BaseProofPublisher.name);
  private contract: ProofAnchorContractLike | null = null;

  constructor(
    @Inject(BASE_PROOF_PUBLISHER_CONFIG)
    private readonly config: BaseProofPublisherConfig,
    @Optional()
    @Inject(PROOF_ANCHOR_CONTRACT_FACTORY)
    private readonly contractFactory?: (
      config: BaseProofPublisherConfig,
    ) => ProofAnchorContractLike,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      return;
    }
    this.ensureContract();
  }

  async post(
    tapsRoot: string,
    priceLogHash: string,
    fromMs: number,
    toMs: number,
  ): Promise<ProofPostResult> {
    const contract = this.ensureContract();
    const tx = await contract.postRoot(tapsRoot, priceLogHash, fromMs, toMs);
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error('ProofAnchor transaction receipt missing');
    }

    const targetAddress = this.config.contractAddress.toLowerCase();
    for (const log of receipt.logs ?? []) {
      if (log.address && log.address.toLowerCase() !== targetAddress) {
        continue;
      }
      try {
        const parsed = proofAnchorInterface.parseLog(log);
        if (parsed?.name === 'RootPosted') {
          return {
            txHash: receipt.hash ?? tx.hash,
            index: Number(parsed.args.index),
          };
        }
      } catch {
        // Ignore unrelated logs in the receipt.
      }
    }

    throw new Error('RootPosted event not found in transaction receipt');
  }

  private ensureContract(): ProofAnchorContractLike {
    if (this.contract) {
      return this.contract;
    }
    this.validateConfig();

    if (this.contractFactory) {
      this.contract = this.contractFactory(this.config);
      return this.contract;
    }

    const provider = new JsonRpcProvider(this.config.rpcUrl);
    const signer = new Wallet(this.config.relayerPrivateKey, provider);
    this.contract = new Contract(
      this.config.contractAddress,
      PROOF_ANCHOR_ABI,
      signer,
    ) as unknown as ProofAnchorContractLike;
    this.logger.log(
      `ProofAnchor publisher initialized for ${this.config.contractAddress}`,
    );
    return this.contract;
  }

  private validateConfig(): void {
    if (!this.isValidRpcUrl(this.config.rpcUrl)) {
      throw new Error(
        'PROOF_ANCHOR_ENABLED is true but RPC_URL is missing or invalid',
      );
    }
    if (!isAddress(this.config.contractAddress)) {
      throw new Error(
        'PROOF_ANCHOR_ENABLED is true but PROOF_ANCHOR_ADDRESS is missing or invalid',
      );
    }
    if (!this.config.relayerPrivateKey) {
      throw new Error(
        'PROOF_ANCHOR_ENABLED is true but RELAYER_PRIVATE_KEY is missing or invalid',
      );
    }
    try {
      new Wallet(this.config.relayerPrivateKey);
    } catch {
      throw new Error(
        'PROOF_ANCHOR_ENABLED is true but RELAYER_PRIVATE_KEY is missing or invalid',
      );
    }
  }

  private isValidRpcUrl(raw: string): boolean {
    if (!raw || !raw.trim()) {
      return false;
    }
    try {
      const parsed = new URL(raw);
      return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
}
