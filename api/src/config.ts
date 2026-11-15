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

/** `postgresql://usuario:clave@host[:puerto]/base`, el formato que entrega Render (`connectionString`). */
function databaseFromUrl(raw: string): AppConfig['database'] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Sin reenviar `raw`: lleva la contraseña y no debe llegar a los logs.
    throw new Error('DATABASE_URL no es una URL válida');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL debe usar el esquema postgres:// o postgresql://');
  }
  const database = {
    host: url.hostname,
    port: toPort('DATABASE_URL (puerto)', url.port, 5432),
    name: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  if (!database.host || !database.name || !database.user || !database.password) {
    throw new Error('DATABASE_URL debe incluir usuario, contraseña, host y nombre de la base');
  }
  return database;
}

function databaseFromEnv(env: NodeJS.ProcessEnv): AppConfig['database'] {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
  return {
    host: env.DB_HOST!,
    port: toPort('DB_PORT', env.DB_PORT, 5432),
    name: env.DB_NAME!,
    user: env.DB_USER!,
    password: env.DB_PASSWORD!,
  };
}

/**
 * Lee y valida el entorno al arrancar: sin valores por defecto para credenciales (falla rápido).
 * La base se configura con `DATABASE_URL` (Render) o, si no existe, con `DB_*` (Docker Compose).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const database = env.DATABASE_URL ? databaseFromUrl(env.DATABASE_URL) : databaseFromEnv(env);
  return {
    port: toPort('PORT', env.PORT, 3000),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    database,
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
