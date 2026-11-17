import { Module } from '@nestjs/common';
import { PlayerModule } from '../player/player.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  SIGNATURE_VERIFIER,
  createRpcSignatureVerifier,
} from './signature-verifier';
import { env } from '../../config';

@Module({
  imports: [PlayerModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: SIGNATURE_VERIFIER,
      useFactory: () => createRpcSignatureVerifier(env.web3.rpcUrl),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
