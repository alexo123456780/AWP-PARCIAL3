import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from './config.js';

/** Configuración común a main.ts y a las pruebas e2e, para que prueben lo mismo que corre. */
export function configureApp(
  app: INestApplication,
  {
    corsOrigins,
    trustProxy = 0,
  }: Pick<AppConfig, 'corsOrigins'> & Partial<Pick<AppConfig, 'trustProxy'>>,
) {
  app.setGlobalPrefix('api');
  // Detrás del proxy de Render, `req.ip` es la IP del cliente solo si se confía en ese salto (límite de login por IP).
  if (trustProxy > 0) (app as NestExpressApplication).set('trust proxy', trustProxy);
  // Cabeceras de seguridad con los valores de Helmet 8 (incluidas en Nest 12.1+, sin paquete extra).
  app.useSecurityHeaders();
  // Allowlist: un origen que no está en la lista no recibe Access-Control-Allow-Origin.
  app.enableCors({ origin: corsOrigins });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const document = new DocumentBuilder()
    .setTitle('CivicGuard API')
    .setDescription('API REST de CivicGuard PWA')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // Servido en /api/docs (el prefijo global se antepone con useGlobalPrefix).
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, document), {
    useGlobalPrefix: true,
  });
}
