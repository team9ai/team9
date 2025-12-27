import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwtPayload } from './decorators/current-user.decorator.js';

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();

    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret:
          process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      });

      (client as Socket & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new WsException('Invalid authentication token');
    }
  }
}
