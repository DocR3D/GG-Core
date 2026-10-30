// src/adapters/http/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from '@app/auth/auth.service';
import { AuthController } from './auth.controller';
import { AuthMiddleware } from './auth.middleware';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthMiddleware],
  exports: [AuthService, AuthMiddleware],
})
export class AuthModule {}
