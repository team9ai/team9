import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthModule as SharedAuthModule } from '@team9/auth';
import { EmailModule } from '@team9/email';
import { env } from '@team9/shared';
import { InternalAuthController } from './internal-auth.controller.js';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { TurnstileService } from './turnstile.service.js';

const accessTokenExpiresIn = env.JWT_EXPIRES_IN as JwtSignOptions['expiresIn'];

@Module({
  imports: [
    SharedAuthModule,
    EmailModule,
    JwtModule.register({
      privateKey: env.JWT_PRIVATE_KEY,
      publicKey: env.JWT_PUBLIC_KEY,
      signOptions: {
        algorithm: 'ES256',
        expiresIn: accessTokenExpiresIn,
      },
      verifyOptions: {
        algorithms: ['ES256'],
      },
    }),
  ],
  controllers: [AuthController, InternalAuthController],
  providers: [AuthService, InternalAuthGuard, TurnstileService],
  exports: [AuthService, SharedAuthModule],
})
export class AuthModule {}
