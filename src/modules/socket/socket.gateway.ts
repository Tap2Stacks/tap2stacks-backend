/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { EventName, getUserRoom, PlaceOrderPayload, SubscribeUserPayload } from './types';
import { AuthService } from '../auth/auth.service';
import { OrderService } from '../order/order.service';
import { getCellId } from 'src/libs/cell';

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: change to production domain
  },
})
export class SocketGateway {
  private readonly logger: Logger = new Logger(SocketGateway.name);

  constructor(
    private readonly authService: AuthService,
    private readonly orderService: OrderService,
  ) {

  }
  @WebSocketServer() server: Server;

  @SubscribeMessage(EventName.SubscribeUser)
  async handleSubscribeUser(@ConnectedSocket() client: Socket, @MessageBody() payload: SubscribeUserPayload) {
    if (!payload?.userId || !payload?.signature) {
      client.send('Invalid wss signature');
      return;
    }

    const message = payload.userId;
    const signature = payload.signature;

    let isValid = false;
    try {
      isValid = await this.authService.validateWssSignature(payload.userId, message, signature, true);
    } catch {
      isValid = false;
    }

    if (isValid) {
      const room = getUserRoom(payload.userId);
      await client.join(room);

      client.emit('subscribed', { room, status: 'success' });

      this.logger.log(`User ${client.id} joined ${room}`);
    } else {
      client.send('Invalid wss signature');
    }

  }

  @SubscribeMessage(EventName.PlaceBet)
  async handlePlaceBet(@ConnectedSocket() client: Socket, @MessageBody() payload: PlaceOrderPayload) {
    if (!payload?.userId || !payload?.cell || !payload?.userSignature) {
      client.send('Invalid wss signature');
      return;
    }

    const cellId = getCellId(payload.cell);
    const message = `${payload.cell.gridTs}:${cellId}:${payload.amount}`;

    let isValid = false;
    try {
      isValid = await this.authService.validateWssSignature(payload.userId, message, payload.userSignature, false);
    } catch {
      isValid = false;
    }

    if (isValid) {
      try {
        await this.orderService.placeOrder(payload.userId, {
          amount: payload.amount,
          cell: payload.cell,
          marketId: payload.marketId,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Place bet failed: ${errMsg}`);
        client.send(`Place bet failed: ${errMsg}`);
      }
    } else {
      client.send('Invalid wss signature');
    }
  }
}
