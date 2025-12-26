import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthGuard } from './guards/auth.guard';
import { WsAuthGuard } from './guards/ws-auth.guard';
import { env } from '@team9/shared';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  providers: [JwtStrategy, AuthGuard, WsAuthGuard],
  exports: [JwtModule, PassportModule, JwtStrategy, AuthGuard, WsAuthGuard],
})
export class AuthModule {}
