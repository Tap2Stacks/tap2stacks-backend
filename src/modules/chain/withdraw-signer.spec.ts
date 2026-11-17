import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.POSTGRES_URL ??=
    'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??=
    '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??=
    '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import { verifyTypedData, Wallet } from 'ethers';
import {
  WithdrawSignerService,
  WITHDRAW_TYPES,
} from './withdraw-signer.service';
describe('withdraw signing', () => {
  it('recovers the signer with the Tap2StacksVault domain', async () => {
    const wallet = new Wallet(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    const vault = '0x2222222222222222222222222222222222222222';
    const player = '0x3333333333333333333333333333333333333333';
    const signer = new WithdrawSignerService(
      { vaultAddress: vault, signerKey: wallet.privateKey } as any,
      {} as any,
    );
    const signature = await signer.sign(player, 12500000n, 7n, 1000);
    expect(
      verifyTypedData(
        {
          name: 'Tap2StacksVault',
          version: '1',
          chainId: 84532,
          verifyingContract: vault,
        },
        WITHDRAW_TYPES,
        { player, amount: 12500000n, nonce: 7n, deadline: 1000 },
        signature,
      ),
    ).toBe(wallet.address);
  });
});
