import { Logger } from '@nestjs/common';
import {
  Address,
  Hex,
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  verifyMessage,
} from 'viem';
import { baseSepolia } from 'viem/chains';

export const SIGNATURE_VERIFIER = 'SIGNATURE_VERIFIER';

export interface SignatureVerifier {
  verify(address: string, message: string, signature: string): Promise<boolean>;
}

/** The subset of a viem public client used for ERC-1271 / ERC-6492 checks. */
export interface ContractSignatureClient {
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
}

const logger = new Logger('SignatureVerifier');

async function verifyPlainWallet(address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    return await verifyMessage({ address, message, signature });
  } catch {
    // Not a 65-byte ECDSA signature (smart wallets wrap theirs); the chain check decides.
    return false;
  }
}

/**
 * Plain wallets are checked locally. Smart wallets (Base Account, Coinbase Smart Wallet),
 * deployed or not, are checked on chain via ERC-1271 / ERC-6492.
 */
export function createSignatureVerifier(client: ContractSignatureClient): SignatureVerifier {
  return {
    async verify(rawAddress, message, rawSignature) {
      if (!isAddress(rawAddress, { strict: false }) || !isHex(rawSignature, { strict: true }) || rawSignature.length <= 2) {
        return false;
      }
      const address = getAddress(rawAddress);
      const signature = rawSignature as Hex;

      if (await verifyPlainWallet(address, message, signature)) return true;

      try {
        return await client.verifyMessage({ address, message, signature });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`Smart wallet signature check failed for ${address}: ${reason}`);
        return false;
      }
    },
  };
}

export function createRpcSignatureVerifier(rpcUrl: string): SignatureVerifier {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return createSignatureVerifier(client);
}
