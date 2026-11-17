import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
@Injectable()
export class PaymasterRateGuard implements CanActivate {
  private readonly requests = new Map<string, number[]>();
  canActivate(context: ExecutionContext): boolean {
    const ip = context.switchToHttp().getRequest().ip ?? 'unknown';
    const now = Date.now();
    for (const [key, times] of this.requests)
      if (times[times.length - 1] <= now - 60000) this.requests.delete(key);
    const times = (this.requests.get(ip) ?? []).filter(
      (time) => time > now - 60000,
    );
    if (times.length >= 30) throw new HttpException('Too Many Requests', 429);
    this.requests.set(ip, [...times, now]);
    return true;
  }
}
