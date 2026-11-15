import { useCallback, useEffect, useState } from 'react';
import { CameraError, openCamera, stopCamera } from '../modules/camera';

export type CameraState =
  | { status: 'idle' }
  | { status: 'opening' }
  | { status: 'live'; stream: MediaStream }
  | { status: 'error'; error: CameraError };

// No abre nada al montarse: la cámara se pide solo al llamar a `open`.
// Salir de `live` (cerrar, fallar) o desmontar suelta todos los tracks por un único camino: el cleanup del efecto.
export function useCamera() {
  const [state, setState] = useState<CameraState>({ status: 'idle' });
  const opening = state.status === 'opening';
  const stream = state.status === 'live' ? state.stream : null;

  useEffect(() => {
    if (!opening) return;
    let cancelled = false;
    openCamera().then(
      (opened) => {
        // Se desmontó mientras se esperaba el permiso: el stream no tiene dueño y hay que soltarlo ya.
        if (cancelled) stopCamera(opened);
        else setState({ status: 'live', stream: opened });
      },
      (error: CameraError) => {
        if (!cancelled) setState({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [opening]);

  useEffect(() => (stream ? () => stopCamera(stream) : undefined), [stream]);

  const open = useCallback(() => setState({ status: 'opening' }), []);
  const close = useCallback(() => setState({ status: 'idle' }), []);
  const fail = useCallback((error: CameraError) => setState({ status: 'error', error }), []);

  return { ...state, open, close, fail };
}
