import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Interface } from 'ethers';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';

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

import { env } from 'src/config';
import {
  COINBASE_SMART_WALLET_PROXY_BYTECODE,
  COINBASE_SMART_WALLET_V1_1,
} from './coinbase-smart-wallet.constants';
import { PaymasterController } from './paymaster.controller';
import { PaymasterRateGuard } from './paymaster-rate.guard';
import {
  PAYMASTER_CONFIG,
  PAYMASTER_HTTP,
  PAYMASTER_RPC,
  PaymasterService,
} from './paymaster.service';
import { PaymasterTokenGuard } from './paymaster-token.guard';
import { PaymasterTokenService } from './paymaster-token.service';

const iface = new Interface([
  'function execute(address target,uint256 value,bytes data)',
]);
const allowed = '0x1111111111111111111111111111111111111111';
const sender = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const otherSender = '0x9999999999999999999999999999999999999999';

function makeLoginJwt(address: string, expiresIn: string | number = '1d') {
  return jwt.sign({ sub: address }, env.secret.jwtSecret, { expiresIn });
}

function makeUserOpBody(userOpSender: string) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'pm_getPaymasterData',
    params: [
      {
        sender: userOpSender,
        callData: iface.encodeFunctionData('execute', [allowed, 0, '0x']),
        initCode: '0x',
      },
    ],
  };
}

describe('Paymaster capability token routes', () => {
  let app: INestApplication;
  let postMock: ReturnType<typeof vi.fn>;
  let tokenService: PaymasterTokenService;

  beforeAll(async () => {
    postMock = vi.fn().mockResolvedValue({
      data: { jsonrpc: '2.0', id: 1, result: { paymaster: allowed } },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymasterController],
      providers: [
        PaymasterService,
        PaymasterRateGuard,
        PaymasterTokenService,
        PaymasterTokenGuard,
        {
          provide: PAYMASTER_CONFIG,
          useValue: {
            url: 'https://example.invalid/private-secret-url',
            addresses: [allowed, allowed, allowed],
          },
        },
        { provide: PAYMASTER_HTTP, useValue: { post: postMock } },
        {
          provide: PAYMASTER_RPC,
          useValue: {
            getCode: vi
              .fn()
              .mockResolvedValue(COINBASE_SMART_WALLET_PROXY_BYTECODE),
            getStorageAt: vi
              .fn()
              .mockResolvedValue(
                `0x000000000000000000000000${COINBASE_SMART_WALLET_V1_1.implementation.slice(2).toLowerCase()}`,
              ),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    tokenService = moduleRef.get(PaymasterTokenService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /api/paymaster/token with a valid login JWT returns a token and expiresAt ~15 minutes ahead', async () => {
    const loginToken = makeLoginJwt(sender);
    const before = Date.now();
    const res = await request(app.getHttpServer())
      .post('/api/paymaster/token')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(200);

    expect(res.body.token).toEqual(expect.any(String));
    const deltaMs = res.body.expiresAt - before;
    expect(deltaMs).toBeGreaterThanOrEqual(14 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(15 * 60 * 1000 + 2000);
  });

  it('POST /api/paymaster/t/:token forwards with the token address and rejects mismatched sender', async () => {
    const { token } = tokenService.issue(sender);

    const okRes = await request(app.getHttpServer())
      .post(`/api/paymaster/t/${token}`)
      .send(makeUserOpBody(sender))
      .expect(200);
    expect(okRes.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { paymaster: allowed },
    });

    await request(app.getHttpServer())
      .post(`/api/paymaster/t/${token}`)
      .send(makeUserOpBody(otherSender))
      .expect(403);
  });

  it('rejects expired paymaster token and login token on POST /api/paymaster/t/:token with 401', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-18T00:00:00.000Z'));
      const { token } = tokenService.issue(sender);
      vi.advanceTimersByTime(16 * 60 * 1000);

      await request(app.getHttpServer())
        .post(`/api/paymaster/t/${token}`)
        .send(makeUserOpBody(sender))
        .expect(401);
    } finally {
      vi.useRealTimers();
    }

    const loginToken = makeLoginJwt(sender);
    await request(app.getHttpServer())
      .post(`/api/paymaster/t/${loginToken}`)
      .send(makeUserOpBody(sender))
      .expect(401);
  });

  it('JwtAuthGuard rejects a paymaster token with 401 on POST /api/paymaster/token', async () => {
    const { token } = tokenService.issue(sender);

    await request(app.getHttpServer())
      .post('/api/paymaster/token')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('removes the old POST /api/paymaster route (404)', async () => {
    const loginToken = makeLoginJwt(sender);

    await request(app.getHttpServer())
      .post('/api/paymaster')
      .set('Authorization', `Bearer ${loginToken}`)
      .send(makeUserOpBody(sender))
      .expect(404);
  });
});
