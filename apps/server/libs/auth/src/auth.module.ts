import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { AuthGuard } from './guards/auth.guard.js';
import { WsAuthGuard } from './guards/ws-auth.guard.js';
import { env } from '@team9/shared';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        publicKey: env.JWT_PUBLIC_KEY,
        verifyOptions: {
          algorithms: ['ES256'],
        },
      }),
    }),
  ],
  providers: [JwtStrategy, AuthGuard, WsAuthGuard],
  exports: [JwtModule, PassportModule, JwtStrategy, AuthGuard, WsAuthGuard],
})
export class AuthModule {}
