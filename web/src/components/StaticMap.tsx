import { TILE_SIZE, tileAt, tileUrl } from '../modules/map';

const ZOOM = 16; // calle por calle
const SPAN = [-1, 0, 1];

/**
 * Mapa estático de la ubicación de un reporte: un mosaico de 3×3 teselas de OpenStreetMap (sin biblioteca ni clave)
 * centrado en el punto, con un marcador. No se puede arrastrar ni hacer zoom: es solo una referencia visual.
 */
export function StaticMap({ lat, lng }: { lat: number; lng: number }) {
  const { tileX, tileY, offsetX, offsetY } = tileAt(lat, lng, ZOOM);
  // El mosaico se desplaza para que el punto quede en el centro del recuadro.
  const style = {
    left: `calc(50% - ${TILE_SIZE + offsetX}px)`,
    top: `calc(50% - ${TILE_SIZE + offsetY}px)`,
  };
  return (
    <figure className="static-map">
      <div role="img" aria-label="Mapa con la ubicación del reporte" className="static-map-frame">
        <div className="static-map-grid" style={style}>
          {SPAN.flatMap((dy) =>
            SPAN.map((dx) => {
              const url = tileUrl(tileX + dx, tileY + dy, ZOOM);
              return url ? (
                <img key={`${dx},${dy}`} src={url} alt="" width={TILE_SIZE} height={TILE_SIZE} />
              ) : (
                <span key={`${dx},${dy}`} />
              );
            }),
          )}
        </div>
        <span className="static-map-pin" aria-hidden="true">
          📍
        </span>
      </div>
      <figcaption className="field-hint">
        Mapa © <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>
      </figcaption>
    </figure>
  );
}
