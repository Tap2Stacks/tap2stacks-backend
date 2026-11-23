import { Test } from '@nestjs/testing';
import { Interface, JsonRpcProvider, Network, Wallet } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  BASE_PROOF_PUBLISHER_CONFIG,
  BaseProofPublisher,
} from './base-proof.publisher';

// Unit specs build the publisher with `new`, so they never exercised Nest's
// dependency injection. This spec resolves it the way the app module does.
describe('BaseProofPublisher dependency injection', () => {
  it('resolves with only the config provider registered', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BaseProofPublisher,
        {
          provide: BASE_PROOF_PUBLISHER_CONFIG,
          useValue: {
            enabled: false,
            rpcUrl: '',
            contractAddress: '',
            relayerPrivateKey: '',
          },
        },
      ],
    }).compile();

    expect(moduleRef.get(BaseProofPublisher)).toBeInstanceOf(
      BaseProofPublisher,
    );
    await moduleRef.close();
  });
});

describe('BaseProofPublisher Builder Code attribution', () => {
  it.each([84532, 1])('signs attributed calldata only on Base Sepolia (RPC chain %i)', async (chainId) => {
    const network = vi
      .spyOn(JsonRpcProvider.prototype, 'getNetwork')
      .mockResolvedValue(Network.from(chainId));
    const send = vi.spyOn(Wallet.prototype, 'sendTransaction').mockRejectedValue(
      new Error('stop before broadcast'),
    );
    try {
      const publisher = new BaseProofPublisher({
        enabled: true,
        rpcUrl: 'https://sepolia.base.org',
        contractAddress: '0x1111111111111111111111111111111111111111',
        relayerPrivateKey: '0x' + '01'.repeat(32),
        builderCode: 'bc_b7k3p9da',
      });
      const hashes = ['0x' + '02'.repeat(32), '0x' + '03'.repeat(32)] as const;
      const post = publisher.post(...hashes, 1000, 301000);
      if (chainId !== 84532) {
        await expect(post).rejects.toThrow('requires Base Sepolia');
        expect(send).not.toHaveBeenCalled();
        return;
      }

      await expect(post).rejects.toThrow('stop before broadcast');
      const abi = new Interface(['function postRoot(bytes32,bytes32,uint64,uint64)']);
      expect(send).toHaveBeenCalledWith({
        to: '0x1111111111111111111111111111111111111111',
        data:
          abi.encodeFunctionData('postRoot', [...hashes, 1000, 301000]) +
          '62635f62376b33703964610b0080218021802180218021802180218021',
      });
    } finally {
      send.mockRestore();
      network.mockRestore();
    }
  });
});
