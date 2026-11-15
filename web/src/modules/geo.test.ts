import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoError, getPosition, parseCoordinate } from './geo';

// jsdom no trae geolocation: se simula la API con la firma real de getCurrentPosition.
function stubGeolocation(getCurrentPosition: Geolocation['getCurrentPosition'] | undefined) {
  Object.defineProperty(navigator, 'geolocation', {
    value: getCurrentPosition && { getCurrentPosition, watchPosition: vi.fn() },
    configurable: true,
  });
}

const fail = (code: number) => (_ok: PositionCallback, onError?: PositionErrorCallback | null) =>
  onError?.({ code, message: '' } as GeolocationPositionError);

afterEach(() => {
  Reflect.deleteProperty(navigator, 'geolocation');
});

describe('getPosition', () => {
  it('lee lat, lng y accuracy con alta precisión y 10 s de timeout', async () => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((ok) =>
      ok({ coords: { latitude: 20.97, longitude: -89.62, accuracy: 12.5 } } as GeolocationPosition),
    );
    stubGeolocation(getCurrentPosition);

    await expect(getPosition()).resolves.toEqual({ lat: 20.97, lng: -89.62, accuracy: 12.5 });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 10_000,
    });
  });

  it.each([
    [1, 'denied', /permiso/],
    [2, 'unavailable', /no pudo determinar/],
    [3, 'timeout', /10 segundos/],
  ])(
    'con el código %i del navegador rechaza como %s con un mensaje claro',
    async (code, reason, message) => {
      stubGeolocation(fail(code));

      const error = await getPosition().catch((e: GeoError) => e);

      expect(error).toBeInstanceOf(GeoError);
      expect(error).toMatchObject({ reason });
      expect((error as GeoError).message).toMatch(message);
    },
  );

  it('un código desconocido se trata como ubicación no disponible', async () => {
    stubGeolocation(fail(99));

    await expect(getPosition()).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('sin API de geolocalización (navegador viejo o contexto no seguro) rechaza como unsupported', async () => {
    stubGeolocation(undefined);

    await expect(getPosition()).rejects.toMatchObject({ reason: 'unsupported' });
  });
});

describe('parseCoordinate', () => {
  it.each([
    ['20.97', 90, 20.97],
    ['-89.62', 180, -89.62],
    ['  20,97 ', 90, 20.97],
    ['90', 90, 90],
    ['-90', 90, -90],
    ['180', 180, 180],
    ['0', 90, 0],
  ])('acepta %j dentro de ±%i', (text, max, expected) => {
    expect(parseCoordinate(text, max)).toBe(expected);
  });

  it.each([
    ['', 90],
    ['   ', 90],
    ['abc', 90],
    ['90.0001', 90],
    ['-181', 180],
    ['Infinity', 180],
    ['NaN', 180],
    ['1,2,3', 90],
  ])('rechaza %j', (text, max) => {
    expect(parseCoordinate(text, max)).toBeNull();
  });
});
