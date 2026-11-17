import { createHmac } from 'crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { Cell, getCellId, signCell } from 'src/libs/cell';
import { SocketGateway } from './socket.gateway';

describe('SocketGateway auth', () => {
  const userId = '0x1111111111111111111111111111111111111111';
  const wssKeyHex =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const challenge = 'Sign this message to login to TapTrading: abc';

  let authService: {
    validateWssSignature: ReturnType<typeof vi.fn>;
  };
  let orderService: {
    placeOrder: ReturnType<typeof vi.fn>;
  };
  let gateway: SocketGateway;
  let client: {
    id: string;
    join: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    authService = {
      // Async signature check matching AuthService.validateWssSignature
      validateWssSignature: vi.fn(
        async (
          address: string,
          message: string,
          signature: string,
          withChallenge?: boolean,
        ) => {
          const keyBuffer = Buffer.from(wssKeyHex, 'hex');
          const hmac = createHmac('sha256', keyBuffer).update(message);
          if (withChallenge) {
            hmac.update(challenge);
          }
          return (
            address.toLowerCase() === userId.toLowerCase() &&
            hmac.digest('hex') === signature
          );
        },
      ),
    };
    orderService = {
      placeOrder: vi.fn().mockResolvedValue({ orderId: 'o-1' }),
    };
    gateway = new SocketGateway(authService as any, orderService as any);
    client = {
      id: 'sock-1',
      join: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
      send: vi.fn(),
    };
  });

  it('socket: subscribe_user with a wrong HMAC is refused (no room join)', async () => {
    await gateway.handleSubscribeUser(client as any, {
      userId,
      signature: 'deadbeef',
    });

    expect(authService.validateWssSignature).toHaveBeenCalledWith(
      userId,
      userId,
      'deadbeef',
      true,
    );
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalledWith(
      'subscribed',
      expect.anything(),
    );
    expect(client.send).toHaveBeenCalledWith('Invalid wss signature');
  });

  it('socket: subscribe_user with a valid HMAC joins user room', async () => {
    const validSig = createHmac('sha256', Buffer.from(wssKeyHex, 'hex'))
      .update(userId)
      .update(challenge)
      .digest('hex');

    await gateway.handleSubscribeUser(client as any, {
      userId,
      signature: validSig,
    });

    expect(client.join).toHaveBeenCalledWith(`user:${userId}`);
    expect(client.emit).toHaveBeenCalledWith('subscribed', {
      room: `user:${userId}`,
      status: 'success',
    });
  });

  it('socket: place_bet with a wrong userSignature never reaches placeOrder', async () => {
    const baseCell = {
      ticker: 'NVDA',
      gridTs: 1795000000000,
      startTs: 1795000010000,
      endTs: 1795000015000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    };
    const cell: Cell = {
      ...baseCell,
      gridSignature: signCell(baseCell, 'cell-key'),
    };

    await gateway.handlePlaceBet(client as any, {
      userId,
      marketId: 'NVDA',
      amount: '10',
      cell,
      userSignature: 'wrong-signature',
    });

    expect(authService.validateWssSignature).toHaveBeenCalledTimes(1);
    expect(orderService.placeOrder).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith('Invalid wss signature');
  });

  it('socket: place_bet with a valid userSignature calls placeOrder', async () => {
    const baseCell = {
      ticker: 'NVDA',
      gridTs: 1795000000000,
      startTs: 1795000010000,
      endTs: 1795000015000,
      lowerPrice: '157.50',
      upperPrice: '157.53',
      rewardRate: '2.3100',
    };
    const cell: Cell = {
      ...baseCell,
      gridSignature: signCell(baseCell, 'cell-key'),
    };
    const cellId = getCellId(cell);
    const validSig = createHmac('sha256', Buffer.from(wssKeyHex, 'hex'))
      .update(`${cell.gridTs}:${cellId}:10`)
      .digest('hex');

    await gateway.handlePlaceBet(client as any, {
      userId,
      marketId: 'NVDA',
      amount: '10',
      cell,
      userSignature: validSig,
    });

    expect(orderService.placeOrder).toHaveBeenCalledTimes(1);
    expect(orderService.placeOrder).toHaveBeenCalledWith(userId, {
      amount: '10',
      cell,
      marketId: 'NVDA',
    });
  });
});
