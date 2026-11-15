import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Compose inyecta NGROK_DOMAIN (sin esquema) desde .env; vacío = sin túnel.
const ngrokDomain = process.env.NGROK_DOMAIN;

export default defineConfig({
  plugins: [react()],
  server: {
    // Sin caché HTTP en desarrollo: los cambios se ven al recargar y el Service Worker no sirve versiones viejas.
    headers: { 'Cache-Control': 'no-store' },
    // Vite rechaza Hosts desconocidos (anti DNS rebinding); solo se añade el dominio del túnel, nunca `true`.
    allowedHosts: ngrokDomain ? [ngrokDomain] : [],
  },
  test: { environment: 'jsdom' },
});
