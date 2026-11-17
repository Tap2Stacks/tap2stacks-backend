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

@Controller('paymaster')
@UseGuards(PaymasterRateGuard, JwtAuthGuard)
export class PaymasterController {
  constructor(private readonly service: PaymasterService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  forward(@Body() body: unknown, @CurrentUser() user: { address: string }) {
    return this.service.forward(body, user?.address);
  }
}
