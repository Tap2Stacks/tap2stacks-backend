import { Controller, Get } from '@nestjs/common';
import { nextOpeningBell } from './nyse-calendar';
@Controller('sessions')
export class SessionController {
  @Get('next') next() {
    const now = new Date();
    const { startsAt, endsAt } = nextOpeningBell(now);
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      isLive: now >= startsAt && now < endsAt,
    };
  }
}
