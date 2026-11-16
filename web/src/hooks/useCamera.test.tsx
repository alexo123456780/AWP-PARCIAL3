import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CameraError } from '../modules/camera';
import { useCamera } from './useCamera';

describe('useCamera: fallos', () => {
  it('conserva el mensaje de un CameraError', () => {
    const { result } = renderHook(() => useCamera());

    act(() => result.current.fail(new CameraError('denied')));

    expect(result.current).toMatchObject({
      status: 'error',
      error: { reason: 'denied', message: new CameraError('denied').message },
    });
  });

  it('un fallo que no es de la cámara (p. ej. el chunk que no se pudo descargar) se dice en español, no en inglés', () => {
    const { result } = renderHook(() => useCamera());

    act(() => result.current.fail(new TypeError('Failed to fetch dynamically imported module')));

    expect(result.current).toMatchObject({
      status: 'error',
      error: {
        reason: 'unavailable',
        message: expect.stringContaining('No se pudo cargar la cámara'),
      },
    });
  });
});
