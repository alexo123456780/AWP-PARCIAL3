import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from './config.js';

/** Configuración común a main.ts y a las pruebas e2e, para que prueben lo mismo que corre. */
export function configureApp(
  app: INestApplication,
  { corsOrigins }: Pick<AppConfig, 'corsOrigins'>,
) {
  app.setGlobalPrefix('api');
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
    .build();
  // Servido en /api/docs (el prefijo global se antepone con useGlobalPrefix).
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, document), {
    useGlobalPrefix: true,
  });
}
