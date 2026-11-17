import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.POSTGRES_URL ??= 'postgres://postgres:postgres@localhost:5432/st_backend';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.ENGINE_URL ??= 'ws://localhost:8090';
  process.env.ENGINE_TOKEN ??= 'test-engine-token';
  process.env.RPC_URL ??= 'https://sepolia.base.org';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  process.env.ADMIN_API_KEY ??= 'test-admin-api-key-0123456789abcdef';
  process.env.CELL_SIGNER_KEY ??= 'test-cell-signer-key';
  process.env.WITHDRAW_SIGNER_PRIVATE_KEY ??= '0x1111111111111111111111111111111111111111111111111111111111111111';
  process.env.RELAYER_PRIVATE_KEY ??= '0x2222222222222222222222222222222222222222222222222222222222222222';
});

import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { DevFaucetGuard } from './guards/dev-faucet.guard';

describe('POST /api/payment/debug/deposit', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevFaucet = process.env.DEV_FAUCET_ENABLED;

  const mockContext = {} as ExecutionContext;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_FAUCET_ENABLED = 'false';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.DEV_FAUCET_ENABLED = originalDevFaucet;
  });

  it('returns 404 when NODE_ENV is production even if DEV_FAUCET_ENABLED=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEV_FAUCET_ENABLED = 'true';

    const guard = new DevFaucetGuard();
    expect(() => guard.canActivate(mockContext)).toThrow(NotFoundException);
  });

  it('returns 404 when DEV_FAUCET_ENABLED is not true', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_FAUCET_ENABLED = 'false';

    const guard = new DevFaucetGuard();
    expect(() => guard.canActivate(mockContext)).toThrow(NotFoundException);
  });

  it('allows when NODE_ENV is not production and DEV_FAUCET_ENABLED=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.DEV_FAUCET_ENABLED = 'true';

    const guard = new DevFaucetGuard();
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('credits ledger for valid amount 1-1000 and rejects out-of-range amounts', async () => {
    const paymentService = {
      handleDeposit: vi.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new PaymentController(paymentService as any);

    await expect(
      controller.debugDeposit(
        { address: '0x1111111111111111111111111111111111111111' },
        { amount: 0 } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      controller.debugDeposit(
        { address: '0x1111111111111111111111111111111111111111' },
        { amount: 1001 } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    await controller.debugDeposit(
      { address: '0x1111111111111111111111111111111111111111' },
      { amount: 250 } as any,
    );

    expect(paymentService.handleDeposit).toHaveBeenCalledTimes(1);
    expect(paymentService.handleDeposit).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      '250',
      expect.stringMatching(/^debug:/),
      0,
    );
  });
});
