import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');
const html = new DOMParser().parseFromString(read('index.html'), 'text/html');
const manifest = JSON.parse(read('public/manifest.json'));
const css = read('src/styles.css');

const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)![1];

// Contraste WCAG 2.x entre dos colores #rrggbb.
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('cascarón estático de index.html (RF-1)', () => {
  it('trae la cabecera de la marca y skeletons como HTML, sin depender de JS ni de la navegación (depende del perfil)', () => {
    expect(html.querySelector('header.shell-header')?.textContent).toContain('CivicGuard');
    expect(html.querySelector('nav')).toBeNull();
    expect(html.querySelectorAll('#root .skeleton-line').length).toBeGreaterThan(0);
    expect(html.querySelector('noscript')).toBeNull();
  });

  it('enlaza el manifest y la hoja de estilos del sistema de diseño', () => {
    expect(html.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.json');
    expect(html.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      '/src/styles.css',
    );
  });

  it('el color de marca cumple contraste AA con el blanco y con el fondo de la app, en los dos sentidos', () => {
    expect(contrast(token('brand-600'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('brand-600'), token('app'))).toBeGreaterThanOrEqual(4.5);
    // texto de marca oscuro sobre su tinte claro (badges, avisos)
    expect(contrast(token('brand-800'), token('brand-50'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('brand-900'), token('brand-50'))).toBeGreaterThanOrEqual(4.5);
  });

  it('los componentes base miden 44 px como mínimo (botones y controles de formulario)', () => {
    expect(read('src/ui/Button.tsx')).toMatch(/min-h-11 min-w-11/);
    expect(read('src/ui/Field.tsx')).toMatch(/controlStyles =\s*'[^']*min-h-11/);
  });
});

describe('offline.html (RF-7)', () => {
  const offline = new DOMParser().parseFromString(read('public/offline.html'), 'text/html');

  it('es una página en español con un enlace para reintentar', () => {
    expect(offline.documentElement.lang).toBe('es');
    expect(offline.querySelector('h2')?.textContent).toBe('Sin conexión');
    expect(offline.querySelector('a[href="/"]')).not.toBeNull();
  });

  it('es autónoma: sin scripts ni recursos externos que no estarían en caché sin red', () => {
    expect(offline.querySelector('script, link[rel="stylesheet"], img, [src]')).toBeNull();
    expect(offline.querySelector('style')).not.toBeNull();
  });
});

describe('manifest.json (RF-2)', () => {
  it('incluye los campos obligatorios', () => {
    expect(manifest).toMatchObject({
      name: 'CivicGuard',
      short_name: 'CivicGuard',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'es',
    });
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it('usa los mismos colores que el cascarón', () => {
    expect(manifest.theme_color).toBe(token('brand-600'));
    expect(manifest.background_color).toBe(token('app'));
    expect(html.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      manifest.theme_color,
    );
  });
});
