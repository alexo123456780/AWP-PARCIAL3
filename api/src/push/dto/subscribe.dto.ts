import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * El servidor envía a esta URL, así que un endpoint libre sería un SSRF: solo se aceptan los servicios de push de los
 * navegadores (Chrome/FCM, Safari, Firefox y Edge/WNS), por HTTPS y sin credenciales en la URL.
 * shortcut: lista fija de servicios conocidos; ampliarla si aparece otro navegador con su propio servicio.
 */
const PUSH_SERVICE =
  /^https:\/\/(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\/\S*$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Los campos de `PushSubscription.toJSON()` del navegador (`keys.p256dh` y `keys.auth`) más el dispositivo. */
export class SubscribeDto {
  @ApiProperty({ format: 'uuid', description: 'UUID anónimo del dispositivo (el de sus reportes)' })
  @IsUUID()
  reporter_id: string;

  @ApiProperty({ description: 'URL del servicio de push del navegador (HTTPS)' })
  @MaxLength(2048)
  @Matches(PUSH_SERVICE, { message: 'endpoint debe ser la URL HTTPS de un servicio de push' })
  endpoint: string;

  @ApiProperty({ description: 'Clave pública ECDH del navegador, en base64url' })
  @MaxLength(200)
  @Matches(BASE64URL, { message: 'p256dh debe estar en base64url' })
  p256dh: string;

  @ApiProperty({ description: 'Secreto de autenticación del navegador, en base64url' })
  @MaxLength(100)
  @Matches(BASE64URL, { message: 'auth debe estar en base64url' })
  auth: string;
}

export class VapidPublicKeyDto {
  @ApiProperty({ description: 'Clave pública VAPID (base64url) para `pushManager.subscribe`' })
  public_key: string;
}
