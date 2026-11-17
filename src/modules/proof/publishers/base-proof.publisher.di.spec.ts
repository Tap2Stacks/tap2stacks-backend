import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
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
