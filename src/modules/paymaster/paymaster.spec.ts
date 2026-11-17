import { describe, expect, it, vi } from 'vitest';
import { Interface } from 'ethers';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  COINBASE_SMART_WALLET_PROXY_BYTECODE,
  COINBASE_SMART_WALLET_V1_0,
  COINBASE_SMART_WALLET_V1_1,
  PAYMASTER_DAILY_OPS_LIMIT,
} from './coinbase-smart-wallet.constants';
import { PaymasterService } from './paymaster.service';

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

const iface = new Interface([
  'function execute(address target,uint256 value,bytes data)',
]);
const batchIface = new Interface([
  'function executeBatch((address target,uint256 value,bytes data)[] calls)',
]);

const allowed = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const sender = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const otherSender = '0x9999999999999999999999999999999999999999';

function slotFromAddress(address: string): `0x${string}` {
  return `0x000000000000000000000000${address.slice(2).toLowerCase()}`;
}

function makeUserOpRequest(
  overrides: Record<string, unknown> = {},
  method = 'pm_getPaymasterData',
) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: [
      {
        sender,
        callData: iface.encodeFunctionData('execute', [allowed, 0, '0x']),
        initCode: '0x',
        ...overrides,
      },
    ],
  };
}

function setup() {
  const post = vi.fn().mockResolvedValue({
    data: { jsonrpc: '2.0', id: 1, result: { paymaster: allowed } },
  });
  const getCode = vi
    .fn()
    .mockResolvedValue(COINBASE_SMART_WALLET_PROXY_BYTECODE);
  const getStorageAt = vi
    .fn()
    .mockResolvedValue(
      slotFromAddress(COINBASE_SMART_WALLET_V1_1.implementation),
    );

  const service = new (PaymasterService as any)(
    {
      url: 'https://example.invalid/private-secret-url',
      addresses: [allowed, allowed, allowed],
    },
    { post } as any,
    { getCode, getStorageAt } as any,
  );

  return { post, getCode, getStorageAt, service };
}

describe('paymaster proxy', () => {
  it('rejects an unknown target without calling CDP', async () => {
    const { post, service } = setup();
    await expect(
      service.forward(
        makeUserOpRequest({
          callData: iface.encodeFunctionData('execute', [other, 0, '0x']),
        }),
        sender,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects other methods', async () => {
    const { post, service } = setup();
    await expect(
      service.forward(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendTransaction',
          params: [],
        },
        sender,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(post).not.toHaveBeenCalled();
  });

  it('forwards an allowed account call and rejects mixed batches', async () => {
    const { service, post } = setup();
    const body = makeUserOpRequest({}, 'pm_getPaymasterStubData');

    expect(await service.forward(body, sender)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { paymaster: allowed },
    });

    await expect(
      service.forward(
        makeUserOpRequest(
          {
            callData: batchIface.encodeFunctionData('executeBatch', [
              [
                [allowed, 0, '0x'],
                [other, 0, '0x'],
              ],
            ]),
          },
          'pm_getPaymasterStubData',
        ),
        sender,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without contacting CDP when unconfigured', async () => {
    const post = vi.fn();
    const service = new (PaymasterService as any)(
      { url: '', addresses: ['', '', ''] },
      { post } as any,
      { getCode: vi.fn(), getStorageAt: vi.fn() } as any,
    );
    await expect(service.forward({}, sender)).rejects.toMatchObject({
      status: 503,
      message: 'Paymaster not available yet',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('limits each IP to 30 requests in a minute', async () => {
    const { PaymasterRateGuard } = await import('./paymaster-rate.guard');
    const guard = new PaymasterRateGuard();
    const ctx = (ip: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as any;
    for (let i = 0; i < 30; i++) expect(guard.canActivate(ctx('a'))).toBe(true);
    expect(() => guard.canActivate(ctx('a'))).toThrow();
    expect(guard.canActivate(ctx('b'))).toBe(true);
  });

  it('rejects a deployed sender with non-CSW bytecode without calling CDP', async () => {
    const { post, getCode, getStorageAt, service } = setup();
    getCode.mockResolvedValueOnce('0x6080604052');

    await expect(
      service.forward(makeUserOpRequest(), sender),
    ).rejects.toMatchObject({ status: 400 });
    expect(getStorageAt).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a deployed CSW proxy with an unknown implementation slot', async () => {
    const { post, getStorageAt, service } = setup();
    getStorageAt.mockResolvedValueOnce(slotFromAddress(other));

    await expect(
      service.forward(makeUserOpRequest(), sender),
    ).rejects.toMatchObject({ status: 400 });
    expect(post).not.toHaveBeenCalled();
  });

  it('accepts an undeployed sender with a known CSW factory in initCode and rejects unknown factory', async () => {
    const { post, getCode, getStorageAt, service } = setup();
    getCode.mockResolvedValue('0x');

    const validInitCode =
      `${COINBASE_SMART_WALLET_V1_0.factory}deadbeef` as `0x${string}`;
    await expect(
      service.forward(makeUserOpRequest({ initCode: validInitCode }), sender),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { paymaster: allowed },
    });
    expect(getStorageAt).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);

    const invalidInitCode = `${other}deadbeef` as `0x${string}`;
    await expect(
      service.forward(makeUserOpRequest({ initCode: invalidInitCode }), sender),
    ).rejects.toMatchObject({ status: 400 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects when userOp.sender differs from the JWT address', async () => {
    const { post, getCode, service } = setup();
    await expect(
      service.forward(
        makeUserOpRequest({ sender: sender.toLowerCase() }),
        otherSender,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(getCode).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('accepts when userOp.sender matches JWT address case-insensitively', async () => {
    const { post, service } = setup();
    await expect(
      service.forward(
        makeUserOpRequest({ sender: sender.toLowerCase() }),
        sender.toUpperCase().replace('0X', '0x'),
      ),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { paymaster: allowed },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects the 201st sponsored op of the UTC day for a player and resets next UTC day', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-18T23:59:00.000Z'));
      const { post, service } = setup();
      const body = makeUserOpRequest();
      for (let i = 0; i < PAYMASTER_DAILY_OPS_LIMIT; i++) {
        await expect(service.forward(body, sender)).resolves.toBeDefined();
      }
      await expect(service.forward(body, sender)).rejects.toMatchObject({
        status: 429,
      });
      expect(post).toHaveBeenCalledTimes(PAYMASTER_DAILY_OPS_LIMIT);

      vi.setSystemTime(new Date('2026-11-19T00:00:01.000Z'));
      await expect(service.forward(body, sender)).resolves.toBeDefined();
      expect(post).toHaveBeenCalledTimes(PAYMASTER_DAILY_OPS_LIMIT + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches deployed CSW verification for 10 minutes per sender', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-18T00:00:00.000Z'));
      const { getCode, getStorageAt, service } = setup();
      const body = makeUserOpRequest();

      await service.forward(body, sender);
      await service.forward(body, sender);
      expect(getCode).toHaveBeenCalledTimes(1);
      expect(getStorageAt).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      await service.forward(body, sender);
      expect(getCode).toHaveBeenCalledTimes(2);
      expect(getStorageAt).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 503 without forwarding when the RPC check fails', async () => {
    const { post, getCode, service } = setup();
    getCode.mockRejectedValueOnce(new Error('RPC connection refused'));

    await expect(
      service.forward(makeUserOpRequest(), sender),
    ).rejects.toMatchObject({ status: 503 });
    expect(post).not.toHaveBeenCalled();
  });

  it('never leaks CDP_PAYMASTER_URL in upstream responses or error messages', async () => {
    const { post, service } = setup();
    post.mockResolvedValueOnce({
      data: {
        jsonrpc: '2.0',
        id: 1,
        error: 'upstream https://example.invalid/private-secret-url leaked',
      },
    });

    await expect(
      service.forward(makeUserOpRequest(), sender),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('protects PaymasterController with PaymasterRateGuard and JwtAuthGuard', async () => {
    const { PaymasterController } = await import('./paymaster.controller');
    const { PaymasterRateGuard } = await import('./paymaster-rate.guard');
    const { JwtAuthGuard } = await import('../auth/guards/jwt-auth.guard');

    const guards = Reflect.getMetadata(GUARDS_METADATA, PaymasterController);
    expect(guards).toEqual([PaymasterRateGuard, JwtAuthGuard]);

    const forward = vi.fn().mockResolvedValue({ ok: true });
    const controller = new PaymasterController({ forward } as any);
    await expect(
      controller.forward({ test: true }, { address: sender }),
    ).resolves.toEqual({ ok: true });
    expect(forward).toHaveBeenCalledWith({ test: true }, sender);
  });
});
