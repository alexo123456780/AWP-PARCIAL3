import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImage, fitWithin, JPEG_QUALITY, MAX_SIDE } from './image';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'createImageBitmap');
});

describe('fitWithin', () => {
  it.each([
    ['apaisada de 12 MP', 4000, 3000, 1280, 960],
    ['vertical de 12 MP', 3000, 4000, 960, 1280],
    ['cuadrada grande', 2000, 2000, 1280, 1280],
    ['justo en el límite', 1280, 720, 1280, 720],
    ['más chica que el límite: no se amplía', 800, 600, 800, 600],
    ['diminuta: no se amplía', 10, 20, 10, 20],
  ])('%s', (_name, width, height, expectedWidth, expectedHeight) => {
    expect(fitWithin(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
  });

  it('conserva la proporción al redondear (lado mayor exacto, sin deformar)', () => {
    const { width, height } = fitWithin(4032, 3024);
    expect(width).toBe(MAX_SIDE);
    expect(Math.abs(width / height - 4032 / 3024)).toBeLessThan(0.01);
  });
});

// jsdom no tiene createImageBitmap ni canvas: se simulan para comprobar qué se le pide al navegador.
function withBrowserImage(width: number, height: number, blob: Blob | null = new Blob(['jpeg'])) {
  const bitmap = { width, height, close: vi.fn() };
  Object.assign(globalThis, { createImageBitmap: vi.fn().mockResolvedValue(bitmap) });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((done) => done(blob));
  return { bitmap, drawImage, toBlob };
}

describe('compressImage', () => {
  it('dibuja la foto de 12 MP a 1280 px de lado mayor y la exporta como JPEG calidad 0.7', async () => {
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    const { bitmap, drawImage, toBlob } = withBrowserImage(4000, 3000, jpeg);
    const original = new Blob(['x'.repeat(10)], { type: 'image/jpeg' });

    await expect(compressImage(original)).resolves.toBe(jpeg);

    expect(createImageBitmap).toHaveBeenCalledWith(original);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1280, 960);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', JPEG_QUALITY);
    expect(JPEG_QUALITY).toBe(0.7);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('una imagen menor de 1280 px conserva su tamaño (solo se recodifica)', async () => {
    const { drawImage } = withBrowserImage(800, 600);

    await compressImage(new Blob(['x']));

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600);
  });

  it('rechaza y libera la imagen si el navegador no entrega el JPEG', async () => {
    const { bitmap } = withBrowserImage(4000, 3000, null);

    await expect(compressImage(new Blob(['x']))).rejects.toThrow('No se pudo comprimir');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rechaza y libera la imagen si no hay contexto de canvas', async () => {
    const { bitmap } = withBrowserImage(4000, 3000);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(compressImage(new Blob(['x']))).rejects.toThrow('no permite procesar');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('rechaza si el archivo no se puede decodificar como imagen', async () => {
    Object.assign(globalThis, {
      createImageBitmap: vi.fn().mockRejectedValue(new DOMException('bad', 'InvalidStateError')),
    });

    await expect(compressImage(new Blob(['no soy una imagen']))).rejects.toThrow();
  });
});
