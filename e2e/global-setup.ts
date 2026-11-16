import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ORIGIN } from './tests/support/ports.js';

/** Construye la PWA con la URL de la API de prueba incrustada (Vite la fija al construir) y el SW ya inyectado. */
export default function globalSetup() {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  execSync('npm run build', {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, VITE_API_URL: API_ORIGIN },
  });
}
