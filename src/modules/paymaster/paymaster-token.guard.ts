import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PaymasterTokenService } from './paymaster-token.service';

@Injectable()
export class PaymasterTokenGuard implements CanActivate {
  constructor(private readonly tokenService: PaymasterTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const address = this.tokenService.verify(request.params?.token);
    request.user = { address };
    return true;
  }
}
