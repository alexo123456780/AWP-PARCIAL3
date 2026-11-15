import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectImage, PhotoStorage } from './photo-storage.js';

const config = {
  url: 'https://proyecto.supabase.example',
  serviceKey: 'clave-de-prueba',
  bucket: 'fotos',
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1');

afterEach(() => vi.unstubAllGlobals());

describe('detectImage', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg', 'jpg'],
    ['PNG', PNG, 'image/png', 'png'],
    ['WebP', WEBP, 'image/webp', 'webp'],
  ])('reconoce %s por sus primeros bytes', (_name, buffer, contentType, extension) => {
    expect(detectImage(buffer)).toEqual({ contentType, extension });
  });

  it.each([
    ['HTML', Buffer.from('<html></html>')],
    ['PDF', Buffer.from('%PDF-1.7')],
    ['un RIFF que no es WebP (WAV)', Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ', 'latin1')],
    ['un archivo vacío', Buffer.alloc(0)],
  ])('rechaza %s', (_name, buffer) => {
    expect(detectImage(buffer)).toBeNull();
  });
});

describe('PhotoStorage', () => {
  it('sube la foto al bucket con su nombre y devuelve la URL pública', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const url = await new PhotoStorage(config).upload('abc.jpg', JPEG, 'image/jpeg');
    expect(url).toBe('https://proyecto.supabase.example/storage/v1/object/public/fotos/abc.jpg');
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe('https://proyecto.supabase.example/storage/v1/object/fotos/abc.jpg');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer clave-de-prueba',
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true',
      },
    });
  });

  it('responde 503 si el almacenamiento no está configurado, sin llamar a la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new PhotoStorage(undefined).upload('a.jpg', JPEG, 'image/jpeg'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['responde con error', () => Promise.resolve({ ok: false, status: 403 })],
    ['no es alcanzable', () => Promise.reject(new Error('ECONNREFUSED'))],
  ])('responde 502 sin filtrar la clave cuando el almacenamiento %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(response));
    const upload = new PhotoStorage(config).upload('a.jpg', JPEG, 'image/jpeg');
    await expect(upload).rejects.toBeInstanceOf(BadGatewayException);
    await expect(upload).rejects.not.toThrow(/clave-de-prueba/);
  });
});
