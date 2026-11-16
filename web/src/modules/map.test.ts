import { describe, expect, it } from 'vitest';
import { tileAt, tileUrl } from './map';

describe('tileAt', () => {
  it('ubica un punto de Mérida en su tesela de zoom 16 con el desplazamiento dentro de ella', () => {
    // Valores de referencia: fórmula de OpenStreetMap (slippy map) calculada aparte.
    const { tileX, tileY, offsetX, offsetY } = tileAt(20.9674, -89.5926, 16);
    expect([tileX, tileY]).toEqual([16458, 28862]);
    expect(offsetX).toBeCloseTo(42.22, 1);
    expect(offsetY).toBeCloseTo(214.53, 1);
  });

  it('el origen (0, 0) cae en la esquina de la tesela central a zoom 1', () => {
    expect(tileAt(0, 0, 1)).toEqual({ tileX: 1, tileY: 1, offsetX: 0, offsetY: 0 });
  });

  it('recorta la latitud al límite de Web Mercator en vez de salirse de la malla', () => {
    expect(tileAt(90, 0, 4).tileY).toBe(0);
    expect(tileAt(-90, 0, 4).tileY).toBe(15);
  });
});

describe('tileUrl', () => {
  it('arma la dirección zoom/x/y de OpenStreetMap', () => {
    expect(tileUrl(16458, 28862, 16)).toBe('https://tile.openstreetmap.org/16/16458/28862.png');
  });

  it('da la vuelta al mundo en longitud y devuelve null más allá de los polos', () => {
    expect(tileUrl(-1, 3, 2)).toBe('https://tile.openstreetmap.org/2/3/3.png');
    expect(tileUrl(4, 3, 2)).toBe('https://tile.openstreetmap.org/2/0/3.png');
    expect(tileUrl(0, -1, 2)).toBeNull();
    expect(tileUrl(0, 4, 2)).toBeNull();
  });
});
