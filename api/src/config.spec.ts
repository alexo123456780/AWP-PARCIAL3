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
