import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env.POSTGRES_URL ??=
    'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??=
    '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??=
    '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import {
  countryFromRequest,
  geofenceHttp,
  socketGeofence,
} from './geofence.middleware';
vi.mock('geoip-lite', () => ({
  lookup: (ip: string) =>
    ip === '8.8.8.8'
      ? { country: 'US' }
      : ip === '1.1.1.1'
        ? { country: 'VN' }
        : null,
}));
describe('geofence', () => {
  it('returns 451 for a US IP and passes a VN IP', () => {
    const next = vi.fn(),
      response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    geofenceHttp(true)(
      {
        headers: {},
        socket: { remoteAddress: '8.8.8.8' },
        path: '/api/auth/login',
      } as any,
      response as any,
      next,
    );
    expect(response.status).toHaveBeenCalledWith(451);
    expect(response.json).toHaveBeenCalledWith({
      error: 'UNAVAILABLE_IN_REGION',
    });
    geofenceHttp(true)(
      {
        headers: {},
        socket: { remoteAddress: '1.1.1.1' },
        path: '/api/auth/login',
      } as any,
      response as any,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('refuses a socket handshake from a US IP', () => {
    const next = vi.fn();
    socketGeofence(true)(
      { handshake: { headers: {}, address: '8.8.8.8' } } as any,
      next,
    );
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
it('allows the health check and disables the gate when configured off', () => {
  const next = vi.fn(),
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const request = {
    headers: {},
    socket: { remoteAddress: '8.8.8.8' },
    path: '/api/health-check',
  } as any;
  geofenceHttp(true)(request, res as any, next);
  geofenceHttp(false)(
    { ...request, path: '/api/auth/login' },
    res as any,
    next,
  );
  expect(next).toHaveBeenCalledTimes(2);
});

describe('trusted proxy selection', () => {
  it('ignores a spoofed x-forwarded-for by default', () => {
    expect(
      countryFromRequest({ 'x-forwarded-for': '1.1.1.1' }, '8.8.8.8'),
    ).toBe('US');
  });
  it('uses Fly-Client-IP only on Fly', () => {
    const before = process.env.FLY_APP_NAME;
    try {
      delete process.env.FLY_APP_NAME;
      expect(
        countryFromRequest({ 'fly-client-ip': '1.1.1.1' }, '8.8.8.8'),
      ).toBe('US');
      process.env.FLY_APP_NAME = 'test-app';
      expect(
        countryFromRequest({ 'fly-client-ip': '1.1.1.1' }, '8.8.8.8'),
      ).toBe('VN');
    } finally {
      if (before === undefined) delete process.env.FLY_APP_NAME;
      else process.env.FLY_APP_NAME = before;
    }
  });
  it('uses the right-most hop with TRUSTED_PROXY_HOPS=1', async () => {
    const { env } = await import('../../config');
    const previous = env.flag.trustedProxyHops;
    try {
      env.flag.trustedProxyHops = 1;
      expect(
        countryFromRequest(
          { 'x-forwarded-for': '8.8.8.8, 1.1.1.1' },
          '8.8.8.8',
        ),
      ).toBe('VN');
    } finally {
      env.flag.trustedProxyHops = previous;
    }
  });
});
