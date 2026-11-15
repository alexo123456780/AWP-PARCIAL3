// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const publicPath = (path: string) =>
  resolve(import.meta.dirname, '../public', path.replace(/^\//, ''));
const manifest = JSON.parse(readFileSync(publicPath('manifest.json'), 'utf8')) as {
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

// Decodifica un PNG RGBA de 8 bits con filtro 0 (el que escribe scripts/generate-icons.mjs).
function readPng(path: string) {
  const file = readFileSync(publicPath(path));
  expect(file.subarray(1, 4).toString('ascii')).toBe('PNG');
  const [width, height] = [file.readUInt32BE(16), file.readUInt32BE(20)];
  expect([file[24], file[25]]).toEqual([8, 6]);

  const data: Buffer[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    if (file.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      data.push(file.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixel = (x: number, y: number) => [
    ...raw.subarray(y * (stride + 1) + 1 + x * 4).subarray(0, 4),
  ];
  for (let y = 0; y < height; y++) expect(raw[y * (stride + 1)]).toBe(0);
  return { width, height, pixel };
}

describe('íconos del manifest (RF-2)', () => {
  it.each([
    ['any', 192],
    ['any', 512],
    ['maskable', 192],
    ['maskable', 512],
  ])('declara el ícono %s de %ix%i, existe y mide lo que dice', (purpose, size) => {
    const icon = manifest.icons.find(
      (candidate) => candidate.purpose === purpose && candidate.sizes === `${size}x${size}`,
    );

    expect(icon?.type).toBe('image/png');
    expect(existsSync(publicPath(icon!.src))).toBe(true);
    expect(readPng(icon!.src)).toMatchObject({ width: size, height: size });
  });

  it('declara exactamente esos cuatro íconos, cada uno con un solo purpose', () => {
    expect(manifest.icons).toHaveLength(4);
  });

  it.each([192, 512])(
    'el maskable de %i es de lienzo completo y su contenido cabe en el 80 %% central',
    (size) => {
      const { pixel } = readPng(`/icons/icon-maskable-${size}.png`);
      const background = pixel(0, 0);
      const safeRadius = 0.4 * size; // zona segura del W3C: círculo de radio 40 % del lado
      let content = 0;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const color = pixel(x, y);
          expect(color[3]).toBe(255); // sin transparencia: Android recorta el ícono, no lo rellena
          if (color.join() === background.join()) continue;
          content++;
          expect(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)).toBeLessThanOrEqual(
            safeRadius,
          );
        }
      }
      expect(content).toBeGreaterThan(0); // el escudo existe: no es un lienzo liso
    },
  );
});
