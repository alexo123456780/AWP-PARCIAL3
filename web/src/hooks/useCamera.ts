import { useCallback, useEffect, useState } from 'react';
import type { CameraError } from '../modules/camera';

// La cámara va en su propio chunk: solo se descarga al tocar «Tomar foto» (y queda precacheado por el Service Worker).
const loadCamera = () => import('../modules/camera');

/** Lo que la pantalla necesita de un fallo de la cámara: el motivo y un mensaje ya en español. */
export type CameraFailure = Pick<CameraError, 'reason' | 'message'>;

export type CameraState =
  | { status: 'idle' }
  | { status: 'opening' }
  | { status: 'live'; stream: MediaStream }
  | { status: 'error'; error: CameraFailure };

// Un `CameraError` ya trae su mensaje; cualquier otro fallo (p. ej. el chunk de la cámara que no se pudo descargar)
// se dice con un mensaje propio en vez de mostrar el texto en inglés del navegador.
function toFailure(error: unknown): CameraFailure {
  if (error instanceof Error && 'reason' in error) return error as CameraError;
  return {
    reason: 'unavailable',
    message: 'No se pudo cargar la cámara. Revisa tu conexión o elige una foto con el selector.',
  };
}

// No abre nada al montarse: la cámara se pide solo al llamar a `open`.
// Salir de `live` (cerrar, fallar) o desmontar suelta todos los tracks por un único camino: el cleanup del efecto.
export function useCamera() {
  const [state, setState] = useState<CameraState>({ status: 'idle' });
  const opening = state.status === 'opening';
  const stream = state.status === 'live' ? state.stream : null;

  useEffect(() => {
    if (!opening) return;
    let cancelled = false;
    loadCamera()
      .then(({ openCamera, stopCamera }) =>
        openCamera().then((opened) => {
          // Se desmontó mientras se esperaba el permiso: el stream no tiene dueño y hay que soltarlo ya.
          if (cancelled) stopCamera(opened);
          else setState({ status: 'live', stream: opened });
        }),
      )
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: toFailure(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [opening]);

  // Suelta los tracks al instante y sin esperar al chunk de la cámara: la luz de la cámara sigue encendida mientras
  // haya tracks vivos.
  useEffect(
    () => (stream ? () => stream.getTracks().forEach((track) => track.stop()) : undefined),
    [stream],
  );

  const open = useCallback(() => setState({ status: 'opening' }), []);
  const close = useCallback(() => setState({ status: 'idle' }), []);
  const fail = useCallback(
    (error: unknown) => setState({ status: 'error', error: toFailure(error) }),
    [],
  );

  return { ...state, open, close, fail };
}
