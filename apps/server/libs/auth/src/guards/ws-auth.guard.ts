import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import type { JwtPayload } from '../interfaces/jwt-payload.interface.js';
import { env } from '@team9/shared';

interface SocketHandshakeAuth {
  token?: string;
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  private getTokenFromHandshake(client: Socket): string | null {
    const auth = client.handshake.auth as SocketHandshakeAuth;
    const authorizationHeader = client.handshake.headers.authorization;
    const bearerToken =
      typeof authorizationHeader === 'string'
        ? authorizationHeader.replace('Bearer ', '')
        : null;

    return auth.token ?? bearerToken;
  }

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient();
    const token = this.getTokenFromHandshake(client);

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        publicKey: env.JWT_PUBLIC_KEY,
        algorithms: ['ES256'],
      });

      (client as Socket & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new WsException('Invalid authentication token');
    }
  }
}
