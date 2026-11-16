import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import webpush from 'web-push';
import { loadConfig } from '../config.js';
import { PushSubscriptionEntity } from './push-subscription.entity.js';
import { PushController } from './push.controller.js';
import { PushService, VAPID, WEB_PUSH } from './push.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscriptionEntity])],
  controllers: [PushController],
  providers: [
    PushService,
    { provide: WEB_PUSH, useValue: webpush },
    { provide: VAPID, useFactory: () => loadConfig().push },
  ],
  exports: [PushService],
})
export class PushModule {}
