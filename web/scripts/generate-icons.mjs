// Genera los íconos de la PWA (SCRUM-162, RF-2) sin dependencias: dibuja el escudo con visto bueno de CivicGuard
// y lo guarda como PNG en public/icons/. La salida se versiona; se vuelve a correr solo si cambia el diseño:
//   node scripts/generate-icons.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { crc32, deflateSync } from 'node:zlib';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');
const BRAND = [0x0b, 0x5c, 0xab]; // --brand de shell.css
const WHITE = [255, 255, 255];
const SAMPLES = 4; // 4×4 muestras por píxel: bordes suavizados

// Fracción del lado que ocupa cada unidad del glifo. El escudo mide 2 × 2.2 unidades y su punto más lejano al
// centro está a ~1.49: con 0.255 queda a 0.38 del lado, dentro de la zona segura del maskable (círculo de radio 0.4).
const SCALE = { any: 0.34, maskable: 0.255 };
const CORNER = 0.2; // radio de las esquinas del ícono `any`, como fracción del lado

// Glifo en unidades propias, con el centro vertical del escudo en y = 0.1.
function glyphColor(x, y) {
  const shieldY = y + 0.1;
  const dist = (ax, ay, bx, by) => {
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (shieldY - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), shieldY - (ay + t * dy));
  };
  if (Math.min(dist(-0.46, -0.02, -0.14, 0.3), dist(-0.14, 0.3, 0.46, -0.4)) <= 0.13) return BRAND;
  const half = shieldY <= 0 ? 1 : (1 - shieldY / 1.2) ** 0.7;
  return shieldY >= -1 && shieldY <= 1.2 && Math.abs(x) <= half ? WHITE : null;
}

// `any` es un cuadrado redondeado con esquinas transparentes; `maskable` ocupa todo el lienzo y Android lo recorta.
function sample(u, v, purpose) {
  const glyph = glyphColor(u / SCALE[purpose], v / SCALE[purpose]);
  if (glyph) return glyph;
  if (purpose === 'maskable') return BRAND;
  const [qx, qy] = [Math.abs(u) - (0.5 - CORNER), Math.abs(v) - (0.5 - CORNER)];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= CORNER ? BRAND : null;
}

function render(size, purpose) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      let opaque = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = sample(
            (px + (sx + 0.5) / SAMPLES) / size - 0.5,
            (py + (sy + 0.5) / SAMPLES) / size - 0.5,
            purpose,
          );
          if (!color) continue;
          opaque++;
          color.forEach((channel, i) => (sum[i] += channel));
        }
      }
      const offset = (py * size + px) * 4;
      if (opaque) sum.forEach((total, i) => (rgba[offset + i] = Math.round(total / opaque)));
      rgba[offset + 3] = Math.round((255 * opaque) / SAMPLES ** 2);
    }
  }
  return rgba;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// PNG RGBA de 8 bits, todas las filas con filtro 0.
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = size * 4;
  const rows = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++)
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const purpose of ['any', 'maskable']) {
  for (const size of [192, 512]) {
    const name = purpose === 'any' ? `icon-${size}.png` : `icon-maskable-${size}.png`;
    writeFileSync(join(OUT, name), encodePng(size, render(size, purpose)));
    process.stdout.write(`generate-icons: public/icons/${name}\n`);
  }
}
