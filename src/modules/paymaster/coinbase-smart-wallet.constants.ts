import { Address, Hex } from 'viem';

/**
 * Official Coinbase Smart Wallet deployments and ERC-1967 proxy constants.
 *
 * Sources:
 * - v1.1.0 release & deployment script:
 *   https://github.com/coinbase/smart-wallet/releases/tag/v1.1.0
 *   https://github.com/coinbase/smart-wallet/blob/v1.1.0/script/DeployFactory.s.sol
 *   Factory:        0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842
 *   Implementation: 0x00000110dCdEdC9581cb5eCB8467282f2926534d
 *
 * - v1.0.0 release & deployment script:
 *   https://github.com/coinbase/smart-wallet/releases/tag/v1.0.0
 *   https://github.com/coinbase/smart-wallet/blob/v1.0.0/script/DeployFactory.s.sol
 *   Factory:        0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a
 *   Implementation: 0x000100abaad02f1cfC8Bbe32bD5a564817339E72
 *
 * - ERC-1967 proxy runtime bytecode (Solady LibClone.createDeterministicERC1967,
 *   identical across v1.0.0 and v1.1.0):
 *   https://github.com/coinbase/smart-wallet/blob/main/src/CoinbaseSmartWalletFactory.sol
 *   https://github.com/Vectorized/solady/blob/5ea5d9f57ed6d24a27d00934f4a3448def931415/src/utils/LibClone.sol
 */
export const ERC1967_IMPLEMENTATION_SLOT: Hex =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export const COINBASE_SMART_WALLET_PROXY_BYTECODE: Hex =
  '0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3';

export const COINBASE_SMART_WALLET_V1_0 = {
  version: 'v1.0.0',
  factory: '0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a' as Address,
  implementation: '0x000100abaad02f1cfC8Bbe32bD5a564817339E72' as Address,
} as const;

export const COINBASE_SMART_WALLET_V1_1 = {
  version: 'v1.1.0',
  factory: '0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842' as Address,
  implementation: '0x00000110dCdEdC9581cb5eCB8467282f2926534d' as Address,
} as const;

export const COINBASE_SMART_WALLET_FACTORIES: ReadonlySet<Address> = new Set([
  COINBASE_SMART_WALLET_V1_0.factory,
  COINBASE_SMART_WALLET_V1_1.factory,
]);

export const COINBASE_SMART_WALLET_IMPLEMENTATIONS: ReadonlySet<Address> =
  new Set([
    COINBASE_SMART_WALLET_V1_0.implementation,
    COINBASE_SMART_WALLET_V1_1.implementation,
  ]);

export const COINBASE_SMART_WALLET_SENDER_CACHE_TTL_MS = 10 * 60 * 1000;

export const PAYMASTER_DAILY_OPS_LIMIT = 200;
