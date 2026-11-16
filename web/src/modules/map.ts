export const TILE_SIZE = 256;

/**
 * Posición de un punto en la malla de teselas de OpenStreetMap (Web Mercator, «slippy map»): la tesela que lo
 * contiene y a cuántos píxeles de su esquina superior izquierda está.
 */
export function tileAt(lat: number, lng: number, zoom: number) {
  const scale = 2 ** zoom;
  // Web Mercator no llega a los polos: se recorta a su límite para no salir de la malla.
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = ((lng + 180) / 360) * scale;
  const y = ((1 - Math.asinh(Math.tan((clamped * Math.PI) / 180)) / Math.PI) / 2) * scale;
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  return {
    tileX,
    tileY,
    offsetX: (x - tileX) * TILE_SIZE,
    offsetY: (y - tileY) * TILE_SIZE,
  };
}

/** URL de una tesela; `null` si queda fuera de la malla (más allá de los polos). La longitud da la vuelta al mundo. */
export function tileUrl(x: number, y: number, zoom: number): string | null {
  const scale = 2 ** zoom;
  if (y < 0 || y >= scale) return null;
  return `https://tile.openstreetmap.org/${zoom}/${((x % scale) + scale) % scale}/${y}.png`;
}
