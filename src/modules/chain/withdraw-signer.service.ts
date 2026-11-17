import { Inject, Injectable } from '@nestjs/common';
import { Contract, isAddress, JsonRpcProvider, Wallet } from 'ethers';
import { CHAIN_PROVIDER } from './chain-indexer.service';
import vaultAbi from '../../abi/Tap2StacksVault.json';
export const SIGNER_CONFIG = Symbol('SIGNER_CONFIG');
export const WITHDRAW_TYPES = {
  Withdraw: [
    { name: 'player', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};
@Injectable()
export class WithdrawSignerService {
  constructor(
    @Inject(SIGNER_CONFIG)
    private readonly config: {
      vaultAddress: string;
      signerKey: string;
      deployBlock?: number | null;
    },
    @Inject(CHAIN_PROVIDER) private readonly provider: JsonRpcProvider,
  ) {}
  get vault(): string {
    return this.config.vaultAddress;
  }
  available(): boolean {
    return (
      isAddress(this.config.vaultAddress) &&
      !!this.config.signerKey &&
      this.config.deployBlock != null
    );
  }
  async nonce(player: string): Promise<bigint> {
    return new Contract(this.vault, vaultAbi, this.provider).nonces(player);
  }
  async sign(
    player: string,
    amountBase: bigint,
    nonce: bigint,
    deadline: number,
  ): Promise<string> {
    return new Wallet(this.config.signerKey).signTypedData(
      {
        name: 'Tap2StacksVault',
        version: '1',
        chainId: 84532,
        verifyingContract: this.vault,
      },
      WITHDRAW_TYPES,
      { player, amount: amountBase, nonce, deadline },
    );
  }
}
