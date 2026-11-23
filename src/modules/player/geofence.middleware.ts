import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as geoip from 'geoip-lite';
import { Socket } from 'socket.io';
import { env } from 'src/config';

type Headers = Record<string, string | string[] | undefined>;
function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed || undefined;
}
export function countryFromRequest(
  headers: Headers,
  remoteAddr: string | null | undefined,
): string | null {
  if (process.env.FLY_APP_NAME) {
    const flyIp = firstHeaderValue(headers['fly-client-ip']);
    return flyIp ? (geoip.lookup(flyIp)?.country || null) : null;
  }
  const forwarded = headers['x-forwarded-for'];
  const chain =
    (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
      ?.split(',')
      .map((ip) => ip.trim())
      .filter(Boolean) ?? [];
  const hops = env.flag.trustedProxyHops;
  const fromProxy =
    hops !== null && chain.length >= hops
      ? chain[chain.length - hops]
      : undefined;
  const ip = fromProxy || remoteAddr?.trim();
  return ip ? (geoip.lookup(ip)?.country || null) : null;
}
export function geofenceHttp(enabled: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = (req.originalUrl ?? req.path).split('?')[0].toLowerCase();
    if (enabled && path.startsWith('/api/') && path !== '/api/health-check') {
      const country = countryFromRequest(req.headers, req.socket.remoteAddress);
      const isOrder = req.method === 'POST' && /^\/api\/orders\/?$/.test(path);
      if (country === 'US' || (isOrder && !country)) {
        res.status(451).json({ error: 'UNAVAILABLE_IN_REGION' });
        return;
      }
    }
    next();
  };
}
export function socketGeofence(enabled: boolean) {
  return (socket: Socket, next: (error?: Error) => void): void => {
    if (enabled) {
      const country = countryFromRequest(
        socket.handshake.headers,
        socket.handshake.address,
      );
      if (!country || country === 'US') {
        return next(new Error('UNAVAILABLE_IN_REGION'));
      }
    }
    next();
  };
}
@Injectable()
export class GeofenceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    geofenceHttp(env.flag.geofenceEnabled)(req, res, next);
  }
}
