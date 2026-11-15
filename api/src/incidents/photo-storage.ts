import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import type { AppConfig } from '../config.js';

export interface DetectedImage {
  contentType: string;
  extension: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

/**
 * Tipo real de la imagen por sus primeros bytes: el `Content-Type` del cliente es solo una declaración y
 * un archivo que no es imagen no debe llegar al almacenamiento público.
 */
export function detectImage(buffer: Buffer): DetectedImage | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff]))
    return { contentType: 'image/jpeg', extension: 'jpg' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: 'image/png', extension: 'png' };
  }
  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

/** Sube las fotos a Supabase Storage por su API REST; solo la API toca el almacenamiento (nunca el front-end). */
export class PhotoStorage {
  constructor(private readonly config: AppConfig['storage']) {}

  /** Guarda la foto con ese nombre (si ya existe, la reemplaza) y devuelve su URL pública. */
  async upload(name: string, photo: Buffer, contentType: string): Promise<string> {
    if (!this.config) {
      throw new ServiceUnavailableException('El almacenamiento de fotos no está configurado');
    }
    const { url, serviceKey, bucket } = this.config;
    const path = `${bucket}/${name}`;
    const response = await fetch(`${url}/storage/v1/object/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': contentType,
        // Un reintento del mismo reporte sobrescribe la misma foto en vez de fallar por «ya existe».
        'x-upsert': 'true',
      },
      body: new Uint8Array(photo),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    // Sin reenviar el cuerpo de la respuesta ni la clave: no deben llegar al cliente ni a los logs.
    if (!response?.ok) throw new BadGatewayException('No se pudo guardar la foto');
    return `${url}/storage/v1/object/public/${path}`;
  }
}
