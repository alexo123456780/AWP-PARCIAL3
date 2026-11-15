import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { loadConfig } from '../config.js';
import { AUTH_ENABLED, AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { User } from './user.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: loadConfig().jwt?.secret,
        signOptions: { algorithm: 'HS256', expiresIn: '8h' },
      }),
    }),
    // 5 intentos por minuto y por IP (tras el proxy de Render, ver TRUST_PROXY).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    { provide: AUTH_ENABLED, useFactory: () => Boolean(loadConfig().jwt) },
  ],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
