export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.7;

/** Tamaño que cabe en `max` por su lado mayor, sin deformar y sin ampliar nunca. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Reduce la foto en un canvas (lado mayor 1280 px) y la exporta como JPEG calidad 0.7: una foto de cámara de
 * 12 MP pasa de varios MB a unos cientos de KB, para no saturar IndexedDB ni el ancho de banda (R4).
 * Rechaza si el archivo no se puede decodificar como imagen.
 * shortcut: confía en que `createImageBitmap` respete la orientación EXIF (Chromium y Safari 17+); en un Safari
 * anterior una foto del selector tomada en vertical podría quedar girada. La cámara en vivo no tiene EXIF.
 */
export async function compressImage(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  try {
    const canvas = document.createElement('canvas');
    ({ width: canvas.width, height: canvas.height } = fitWithin(bitmap.width, bitmap.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no permite procesar la foto.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la foto.'))),
        'image/jpeg',
        JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}
