import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export interface AppConfig {
  port: number;
  /** Orígenes que CORS deja pasar; vacío = ningún origen cruzado. */
  corsOrigins: string[];
  database: { host: string; port: number; name: string; user: string; password: string };
  /** Almacenamiento de fotos (Supabase Storage); `undefined` = sin configurar, y un reporte con foto responde 503. */
  storage?: { url: string; serviceKey: string; bucket: string };
  /** Secreto con el que se firman los JWT del coordinador; sin él el login responde 503. */
  jwt?: { secret: string };
  /** Identidad VAPID del servidor de Web Push; `undefined` = sin configurar, y suscribirse responde 503. */
  push?: { publicKey: string; privateKey: string; subject: string };
  /** Proxies de confianza delante de la API (Render = 1): sin esto todos los clientes comparten una IP. */
  trustProxy: number;
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

/** `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (+ `SUPABASE_BUCKET`): todas juntas o ninguna, nunca a medias. */
function storageFromEnv(env: NodeJS.ProcessEnv): AppConfig['storage'] {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: serviceKey } = env;
  if (!url && !serviceKey) return undefined;
  if (!url || !serviceKey) {
    throw new Error('Faltan variables de entorno: SUPABASE_URL y SUPABASE_SERVICE_KEY van juntas');
  }
  return {
    url: url.replace(/\/+$/, ''),
    serviceKey,
    bucket: env.SUPABASE_BUCKET || 'incident-photos',
  };
}

function trustProxyFromEnv(value: string | undefined): number {
  if (!value) return 0;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
    throw new Error('TRUST_PROXY debe ser un entero de 0 a 5');
  }
  return hops;
}

/** Un secreto corto se adivina por fuerza bruta: se exigen 32 caracteres (p. ej. `openssl rand -base64 32`). */
function jwtFromEnv(env: NodeJS.ProcessEnv): AppConfig['jwt'] {
  if (!env.JWT_SECRET) return undefined;
  if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  return { secret: env.JWT_SECRET };
}

/**
 * `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`: todas juntas o ninguna. El par se genera con
 * `npx web-push generate-vapid-keys` (P-256 en base64url: 65 bytes la pública, 32 la privada); el asunto es un
 * `mailto:` o una URL `https:` de contacto que los servicios de push usan si hay un abuso.
 */
function pushFromEnv(env: NodeJS.ProcessEnv): AppConfig['push'] {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = env;
  if (!publicKey && !privateKey && !subject) return undefined;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'Faltan variables de entorno: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT van juntas',
    );
  }
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey)) {
    throw new Error('VAPID_PUBLIC_KEY debe ser una clave P-256 en base64url (87 caracteres)');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey)) {
    throw new Error('VAPID_PRIVATE_KEY debe ser una clave P-256 en base64url (43 caracteres)');
  }
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) {
    throw new Error('VAPID_SUBJECT debe ser un mailto: o una URL https://');
  }
  return { publicKey, privateKey, subject };
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
    storage: storageFromEnv(env),
    jwt: jwtFromEnv(env),
    push: pushFromEnv(env),
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY),
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
