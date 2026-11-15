import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGeolocation } from './useGeolocation';

const geolocation = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };

function stubGeolocation() {
  Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.clearAllMocks();
});

describe('useGeolocation', () => {
  it('no consulta la ubicación al montarse ni de forma continua', () => {
    stubGeolocation();

    const { result } = renderHook(() => useGeolocation());

    expect(result.current.status).toBe('idle');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('al invocar locate pasa por cargando y termina en éxito con la posición', async () => {
    stubGeolocation();
    let resolve!: PositionCallback;
    geolocation.getCurrentPosition.mockImplementation((ok: PositionCallback) => (resolve = ok));
    const { result } = renderHook(() => useGeolocation());

    act(() => result.current.locate());
    expect(result.current.status).toBe('loading');

    await act(async () =>
      resolve({ coords: { latitude: 1, longitude: 2, accuracy: 3 } } as GeolocationPosition),
    );
    expect(result.current).toMatchObject({
      status: 'success',
      position: { lat: 1, lng: 2, accuracy: 3 },
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('si el permiso se deniega termina en error con el motivo', async () => {
    stubGeolocation();
    geolocation.getCurrentPosition.mockImplementation(
      (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1 } as GeolocationPositionError),
    );
    const { result } = renderHook(() => useGeolocation());

    await act(async () => result.current.locate());

    expect(result.current).toMatchObject({ status: 'error', error: { reason: 'denied' } });
  });

  it('una ubicación manual deja el mismo estado de éxito que la del GPS', () => {
    const { result } = renderHook(() => useGeolocation());

    act(() => result.current.setManual({ lat: 10, lng: -20 }));

    expect(result.current).toMatchObject({ status: 'success', position: { lat: 10, lng: -20 } });
  });
});
