import { describe, expect, it } from 'vitest';
import { loadConfig, typeOrmOptions } from './config.js';

const env = {
  DB_HOST: 'db',
  DB_NAME: 'civicguard',
  DB_USER: 'app',
  DB_PASSWORD: 'secret-for-tests',
};

describe('loadConfig', () => {
  it('lee la base de datos y aplica los valores por defecto de PORT y DB_PORT', () => {
    expect(loadConfig(env)).toEqual({
      port: 3000,
      corsOrigins: [],
      database: {
        host: 'db',
        port: 5432,
        name: 'civicguard',
        user: 'app',
        password: 'secret-for-tests',
      },
    });
  });

  it('parsea PORT, DB_PORT y la lista de orígenes CORS (con espacios y elementos vacíos)', () => {
    const config = loadConfig({
      ...env,
      PORT: '4000',
      DB_PORT: '55432',
      CORS_ORIGINS: ' http://localhost:5173 ,https://demo.ngrok-free.app,,',
    });
    expect(config.port).toBe(4000);
    expect(config.database.port).toBe(55432);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://demo.ngrok-free.app']);
  });

  it('falla indicando todas las variables obligatorias ausentes, sin valores por defecto', () => {
    expect(() => loadConfig({ DB_HOST: 'db' })).toThrow(
      'Faltan variables de entorno: DB_NAME, DB_USER, DB_PASSWORD',
    );
  });

  it.each(['abc', '0', '70000', '3.5'])('rechaza DB_PORT inválido (%s)', (DB_PORT) => {
    expect(() => loadConfig({ ...env, DB_PORT })).toThrow('DB_PORT debe ser un puerto válido');
  });
});

describe('loadConfig con DATABASE_URL (Render)', () => {
  it('lee la base de la URL interna de Render, sin puerto (5432 por defecto)', () => {
    expect(
      loadConfig({ DATABASE_URL: 'postgresql://app:clave@dpg-abc123-a/civicguard' }).database,
    ).toEqual({
      host: 'dpg-abc123-a',
      port: 5432,
      name: 'civicguard',
      user: 'app',
      password: 'clave',
    });
  });

  it('respeta el puerto y decodifica usuario y contraseña con caracteres especiales', () => {
    const { database } = loadConfig({
      DATABASE_URL: 'postgres://us%40er:p%40ss%2Fw%3Ard@db.example.com:6543/mi%20base',
    });
    expect(database).toEqual({
      host: 'db.example.com',
      port: 6543,
      name: 'mi base',
      user: 'us@er',
      password: 'p@ss/w:rd',
    });
  });

  it('tiene prioridad sobre DB_* y entonces estas ya no son obligatorias', () => {
    const config = loadConfig({ ...env, DATABASE_URL: 'postgresql://otro:clave@otro-host/otra' });
    expect(config.database.host).toBe('otro-host');
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@h/d' }).database.name).toBe('d');
  });

  it.each([
    ['no es una URL', 'DATABASE_URL no es una URL válida'],
    ['mysql://u:p@h/d', 'DATABASE_URL debe usar el esquema'],
    ['postgresql://h/d', 'DATABASE_URL debe incluir usuario, contraseña, host y nombre'],
    ['postgresql://u:p@h/', 'DATABASE_URL debe incluir usuario, contraseña, host y nombre'],
    ['postgresql://u:p@h:0/d', 'DATABASE_URL (puerto) debe ser un puerto válido'],
  ])('rechaza %s', (DATABASE_URL, message) => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(message);
  });

  it('no incluye la contraseña en los mensajes de error', () => {
    for (const DATABASE_URL of ['mysql://u:clave-secreta@h/d', 'postgresql://:clave-secreta@h/d']) {
      expect(() => loadConfig({ DATABASE_URL })).toThrow(/^(?!.*clave-secreta)/s);
    }
  });
});

describe('typeOrmOptions', () => {
  it('conecta a Postgres con synchronize en false y sin ejecutar migraciones', () => {
    const options = typeOrmOptions(loadConfig(env).database);
    expect(options).toMatchObject({
      type: 'postgres',
      host: 'db',
      port: 5432,
      database: 'civicguard',
      username: 'app',
      synchronize: false,
    });
    expect(options).not.toHaveProperty('migrationsRun', true);
    expect(options).not.toHaveProperty('dropSchema', true);
  });
});
