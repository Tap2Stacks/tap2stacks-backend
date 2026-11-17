import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { TokenBucket } from 'src/libs/token-bucket';

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { bucket: TokenBucket; seen: number }
  >();
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = context.switchToHttp().getRequest().ip ?? 'unknown';
    const now = Date.now();
    for (const [key, value] of this.buckets)
      if (now - value.seen > 60000) this.buckets.delete(key);
    const entry = this.buckets.get(ip) ?? {
      bucket: new TokenBucket({ capacity: 20, refillRatePerSecond: 10 }),
      seen: now,
    };
    entry.seen = now;
    this.buckets.set(ip, entry);
    if (!(await entry.bucket.consume(1)))
      throw new HttpException('Too Many Requests', 429);
    return true;
  }
}
