export type CameraErrorReason = 'denied' | 'unavailable' | 'unsupported';

const MESSAGES: Record<CameraErrorReason, string> = {
  denied:
    'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador o elige una foto con el selector.',
  unavailable:
    'No se pudo abrir la cámara (quizá otra app la está usando). Inténtalo de nuevo o elige una foto con el selector.',
  unsupported: 'Este navegador no permite abrir la cámara aquí. Elige una foto con el selector.',
};

// `message` ya viene en español y listo para mostrarse al usuario.
export class CameraError extends Error {
  constructor(readonly reason: CameraErrorReason) {
    super(MESSAGES[reason]);
  }
}

// Abre la cámara trasera. Quien la abre debe soltarla con `stopCamera` (la luz sigue encendida mientras haya tracks vivos).
export async function openCamera(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (error) {
    // Sin `instanceof Error`: un DOMException de otro realm (iframe, jsdom) no lo cumple.
    const name = (error as Error | undefined)?.name;
    throw new CameraError(
      name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable',
    );
  }
}

export function stopCamera(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

// Dibuja el fotograma actual del <video> en un canvas y lo devuelve como JPEG a resolución completa.
// La compresión (1280 px, calidad 0.7) es del Sprint 3.
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  // videoWidth es 0 mientras el video aún no tiene fotogramas.
  if (!context || canvas.width === 0) return Promise.reject(new CameraError('unavailable'));
  context.drawImage(video, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CameraError('unavailable'))),
      'image/jpeg',
    ),
  );
}
