import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthModule as SharedAuthModule } from '@team9/auth';
import { env } from '@team9/shared';

@Module({
  imports: [
    SharedAuthModule,
    JwtModule.register({
      secret: env.JWT_SECRET,
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, SharedAuthModule],
})
export class AuthModule {}
