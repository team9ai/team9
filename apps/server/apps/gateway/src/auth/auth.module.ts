import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthModule as SharedAuthModule } from '@team9/auth';
import { EmailModule } from '@team9/email';
import { env } from '@team9/shared';

@Module({
  imports: [
    SharedAuthModule,
    EmailModule,
    JwtModule.register({
      privateKey: env.JWT_PRIVATE_KEY,
      publicKey: env.JWT_PUBLIC_KEY,
      signOptions: {
        algorithm: 'ES256',
        expiresIn: env.JWT_EXPIRES_IN as any,
      },
      verifyOptions: {
        algorithms: ['ES256'],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, SharedAuthModule],
})
export class AuthModule {}
