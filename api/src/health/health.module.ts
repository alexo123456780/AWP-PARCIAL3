import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * PLANTILLA para los módulos de negocio (incidents, auth, admin, push). Para crear uno nuevo:
 *  1. Copia esta carpeta a src/<nombre>/ y renombra los archivos y las clases.
 *  2. dto/: una clase por cuerpo/respuesta, con reglas de class-validator (ValidationPipe global)
 *     y @ApiProperty (Swagger). Sin `@Body()` tipado con una clase, la entrada no se valida.
 *  3. <nombre>.service.ts: la lógica y el acceso a datos. Para tablas, declara la entidad y regístrala
 *     con TypeOrmModule.forFeature([Entidad]); el esquema lo crea un changeset de Liquibase
 *     (db/changelog/), nunca TypeORM.
 *  4. <nombre>.controller.ts: solo HTTP; documenta cada endpoint con @ApiTags/@ApiOperation/@ApiOkResponse.
 *  5. Agrega el módulo a `imports` de AppModule y escribe su `.spec.ts` junto al código.
 * La ruta final lleva el prefijo global: @Controller('health') → GET /api/health.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
