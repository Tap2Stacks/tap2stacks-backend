import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

@Injectable()
export class DevFaucetGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const enabled =
      String(process.env.DEV_FAUCET_ENABLED ?? 'false').toLowerCase() ===
      'true';

    if (nodeEnv === 'production' || !enabled) {
      throw new NotFoundException();
    }

    return true;
  }
}
