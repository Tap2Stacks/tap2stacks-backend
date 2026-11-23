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

const US_IP = '8.8.8.8';
const VN_IP = '203.113.131.1';
const UNKNOWN_IP = '127.0.0.1';

const cases = [
  [US_IP, false],
  [VN_IP, true],
  [UNKNOWN_IP, false],
] as const;

describe('geofence', () => {
  it.each(cases)(
    'checks the client IP %s on HTTP orders (pass: %s)',
    (ip, allowed) => {
      const next = vi.fn(),
        response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      geofenceHttp(true)(
        {
          headers: {},
          socket: { remoteAddress: ip },
          method: 'POST',
          originalUrl: '/API/Orders/?source=trade',
        } as any,
        response as any,
        next,
      );
      if (allowed) {
        expect(next).toHaveBeenCalledOnce();
        expect(response.status).not.toHaveBeenCalled();
      } else {
        expect(next).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(451);
        expect(response.json).toHaveBeenCalledWith({
          error: 'UNAVAILABLE_IN_REGION',
        });
      }
    },
  );

  it.each(cases)(
    'checks the client IP %s on socket handshakes (pass: %s)',
    (address, allowed) => {
      const next = vi.fn();
      socketGeofence(true)({ handshake: { headers: {}, address } } as any, next);
      if (allowed) {
        expect(next).toHaveBeenCalledWith();
      } else {
        expect(next).toHaveBeenCalledWith(new Error('UNAVAILABLE_IN_REGION'));
      }
    },
  );
});
it('allows the health check and disables the gate when configured off', () => {
  const next = vi.fn(),
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const request = {
    headers: {},
    socket: { remoteAddress: US_IP },
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
      countryFromRequest({ 'x-forwarded-for': VN_IP }, US_IP),
    ).toBe('US');
  });
  it('requires Fly-Client-IP on Fly and ignores it everywhere else', async () => {
    const { env } = await import('../../config');
    const previousHops = env.flag.trustedProxyHops;
    const before = process.env.FLY_APP_NAME;
    try {
      delete process.env.FLY_APP_NAME;
      expect(
        countryFromRequest({ 'fly-client-ip': VN_IP }, US_IP),
      ).toBe('US');
      process.env.FLY_APP_NAME = 'test-app';
      env.flag.trustedProxyHops = 1;
      expect(
        countryFromRequest({ 'fly-client-ip': VN_IP }, US_IP),
      ).toBe('VN');
      expect(
        countryFromRequest({ 'x-forwarded-for': VN_IP }, US_IP),
      ).toBeNull();
    } finally {
      env.flag.trustedProxyHops = previousHops;
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
          { 'x-forwarded-for': `${US_IP}, ${VN_IP}` },
          US_IP,
        ),
      ).toBe('VN');
    } finally {
      env.flag.trustedProxyHops = previous;
    }
  });
});

it('defaults the geofence on in production and off in local development', async () => {
  const { parseEnv } = await import('../../config');
  const rawEnv = { ...process.env, GEOFENCE_ENABLED: undefined };
  expect(parseEnv({ ...rawEnv, NODE_ENV: 'production' }).flag.geofenceEnabled).toBe(true);
  expect(parseEnv({ ...rawEnv, NODE_ENV: 'local' }).flag.geofenceEnabled).toBe(false);
});
