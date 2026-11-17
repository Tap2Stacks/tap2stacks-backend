import { Module } from '@nestjs/common';
import axios from 'axios';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { env } from 'src/config';
import { PaymasterController } from './paymaster.controller';
import { PaymasterRateGuard } from './paymaster-rate.guard';
import {
  PAYMASTER_CONFIG,
  PAYMASTER_HTTP,
  PAYMASTER_RPC,
  PaymasterService,
} from './paymaster.service';
import { PaymasterTokenGuard } from './paymaster-token.guard';
import { PaymasterTokenService } from './paymaster-token.service';

@Module({
  controllers: [PaymasterController],
  providers: [
    PaymasterService,
    PaymasterRateGuard,
    PaymasterTokenService,
    PaymasterTokenGuard,
    {
      provide: PAYMASTER_CONFIG,
      useFactory: () => ({
        url: env.secret.cdpPaymasterUrl,
        addresses: [
          env.web3.tusdcAddress,
          env.web3.vaultAddress,
          env.web3.proofAnchorAddress,
        ],
      }),
    },
    { provide: PAYMASTER_HTTP, useValue: axios },
    {
      provide: PAYMASTER_RPC,
      useFactory: () =>
        createPublicClient({
          chain: baseSepolia,
          transport: http(env.web3.rpcUrl),
        }),
    },
  ],
})
export class PaymasterModule {}
