import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');
const html = new DOMParser().parseFromString(read('index.html'), 'text/html');
const manifest = JSON.parse(read('public/manifest.json'));
const css = read('src/shell.css');

const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)![1];

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
  it('trae encabezado, navegación y skeletons como HTML, sin depender de JS', () => {
    expect(html.querySelector('header.shell-header')).not.toBeNull();
    expect(html.querySelectorAll('nav.shell-nav a')).toHaveLength(3);
    expect(html.querySelectorAll('main#root .skeleton-line').length).toBeGreaterThan(0);
    expect(html.querySelector('noscript')).toBeNull();
  });

  it('enlaza el manifest y la hoja de estilos propia', () => {
    expect(html.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.json');
    expect(html.querySelector('link[rel="stylesheet"]')).not.toBeNull();
  });

  it('cumple contraste AA y objetivos táctiles de 44 px', () => {
    expect(contrast(token('brand'), token('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('on-brand'), token('brand'))).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.shell-nav a \{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.install-button \{[^}]*min-height:\s*44px/);
  });

  it('el formulario de captura: botones y campos de 44 px y errores con contraste AA', () => {
    expect(css).toMatch(/\.button \{[^}]*min-height:\s*44px/);
    expect(css).toMatch(
      /\.field input,\s*\.field select,\s*\.field textarea \{[^}]*min-height:\s*44px/,
    );
    expect(contrast(token('error'), token('bg'))).toBeGreaterThanOrEqual(4.5);
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
    expect(manifest.theme_color).toBe(token('brand'));
    expect(manifest.background_color).toBe(token('bg'));
    expect(html.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      manifest.theme_color,
    );
  });
});
