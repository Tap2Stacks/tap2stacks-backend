import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymasterRateGuard } from './paymaster-rate.guard';
import { PaymasterService } from './paymaster.service';
import { PaymasterTokenGuard } from './paymaster-token.guard';
import { PaymasterTokenService } from './paymaster-token.service';

@Controller('paymaster')
@UseGuards(PaymasterRateGuard)
export class PaymasterController {
  constructor(
    private readonly service: PaymasterService,
    private readonly tokenService: PaymasterTokenService,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  issueToken(@CurrentUser() user: { address: string }) {
    return this.tokenService.issue(user?.address);
  }

  @Post('t/:token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymasterTokenGuard)
  forward(@Body() body: unknown, @CurrentUser() user: { address: string }) {
    return this.service.forward(body, user?.address);
  }
}
