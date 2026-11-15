import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export interface AppConfig {
  port: number;
  /** Orígenes que CORS deja pasar; vacío = ningún origen cruzado. */
  corsOrigins: string[];
  database: { host: string; port: number; name: string; user: string; password: string };
}

const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'] as const;

function toPort(name: string, value: string | undefined, fallback: number): number {
  const port = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} debe ser un puerto válido (1-65535)`);
  }
  return port;
}

/** Lee y valida el entorno al arrancar: sin valores por defecto para credenciales (falla rápido). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
  return {
    port: toPort('PORT', env.PORT, 3000),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    database: {
      host: env.DB_HOST!,
      port: toPort('DB_PORT', env.DB_PORT, 5432),
      name: env.DB_NAME!,
      user: env.DB_USER!,
      password: env.DB_PASSWORD!,
    },
  };
}

export function typeOrmOptions(db: AppConfig['database']): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    database: db.name,
    username: db.user,
    password: db.password,
    // Cada módulo registra sus entidades con TypeOrmModule.forFeature().
    autoLoadEntities: true,
    // Liquibase es el único dueño del esquema (PRD §5.4): TypeORM solo lee y escribe datos.
    synchronize: false,
  };
}
