import { MapPin } from 'lucide-react';
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
    <figure className="my-1">
      <div
        role="img"
        aria-label="Mapa con la ubicación del reporte"
        className="relative h-64 w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      >
        <div className="absolute grid grid-cols-[repeat(3,256px)]" style={style}>
          {SPAN.flatMap((dy) =>
            SPAN.map((dx) => {
              const url = tileUrl(tileX + dx, tileY + dy, ZOOM);
              return url ? (
                <img
                  key={`${dx},${dy}`}
                  src={url}
                  alt=""
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  className="block"
                />
              ) : (
                <span key={`${dx},${dy}`} />
              );
            }),
          )}
        </div>
        <MapPin
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-full fill-brand-600 text-white drop-shadow"
        />
      </div>
      <figcaption className="mt-1 text-xs text-slate-600">
        Mapa © <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>
      </figcaption>
    </figure>
  );
}
