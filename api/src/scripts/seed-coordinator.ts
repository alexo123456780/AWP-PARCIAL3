import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config.js';

const BCRYPT_COST = 10;
export const MIN_PASSWORD_LENGTH = 12;

interface Db {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

/**
 * Crea el coordinador inicial (RF-9). La contraseña llega por variable de entorno y solo su hash toca la base:
 * nada en claro en el repositorio. Si el correo ya existe no se modifica (no resetea una contraseña por accidente).
 */
export async function seedCoordinator(db: Db, email: string, password: string): Promise<boolean> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`COORDINATOR_PASSWORD debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  // Con ON CONFLICT DO NOTHING el driver de PostgreSQL devuelve [filas, cuenta]; una cuenta de 0 = ya existía.
  const result = await db.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email.toLowerCase(), hash],
  );
  return Array.isArray(result) && result.length > 0;
}

async function main() {
  const { COORDINATOR_EMAIL: email, COORDINATOR_PASSWORD: password } = process.env;
  if (!email || !password) {
    throw new Error('Faltan variables de entorno: COORDINATOR_EMAIL, COORDINATOR_PASSWORD');
  }
  const { database } = loadConfig();
  const dataSource = await new DataSource({
    type: 'postgres',
    host: database.host,
    port: database.port,
    database: database.name,
    username: database.user,
    password: database.password,
    // Render solo acepta conexiones externas con TLS: DB_SSL=true al sembrar desde fuera de su red.
    ssl: process.env.DB_SSL === 'true',
  }).initialize();
  try {
    const created = await seedCoordinator(dataSource, email, password);
    console.log(
      created ? 'Coordinador creado.' : 'Ya existía un coordinador con ese correo; no se cambió.',
    );
  } finally {
    await dataSource.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
