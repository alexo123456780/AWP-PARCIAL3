export interface Coordinates {
  lat: number;
  lng: number;
  /** Metros de error. El GPS siempre lo informa; la captura manual no lo tiene. */
  accuracy?: number;
}

export const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000 };

export type GeoErrorReason = 'denied' | 'timeout' | 'unavailable' | 'unsupported';

const MESSAGES: Record<GeoErrorReason, string> = {
  denied:
    'No diste permiso para usar tu ubicación. Actívalo en los ajustes del navegador o escribe las coordenadas a mano.',
  timeout:
    'No se pudo leer tu ubicación en 10 segundos. Inténtalo de nuevo o escribe las coordenadas a mano.',
  unavailable:
    'Tu dispositivo no pudo determinar la ubicación. Inténtalo de nuevo o escribe las coordenadas a mano.',
  unsupported: 'Este navegador no ofrece ubicación. Escribe las coordenadas a mano.',
};

// Códigos de GeolocationPositionError (el constructor no existe en todos los entornos, por eso números).
const REASON_BY_CODE: Record<number, GeoErrorReason> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};

// `message` ya viene en español y listo para mostrarse al usuario.
export class GeoError extends Error {
  constructor(readonly reason: GeoErrorReason) {
    super(MESSAGES[reason]);
  }
}

// Lee la posición UNA vez (sin watchPosition: no hay rastreo continuo, PRD §4 Privacidad).
// shortcut: el timeout del navegador no cuenta la espera del aviso de permiso; si el usuario lo ignora la promesa no termina; añadir un temporizador propio si hace falta.
export function getPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      (error) => reject(new GeoError(REASON_BY_CODE[error.code] ?? 'unavailable')),
      GEO_OPTIONS,
    );
  });
}

// Texto de un campo de coordenada → número dentro de ±max, o null. Acepta coma decimal (teclados en español).
export function parseCoordinate(text: string, max: number): number | null {
  const clean = text.trim().replace(',', '.');
  const value = clean === '' ? NaN : Number(clean);
  return Number.isFinite(value) && Math.abs(value) <= max ? value : null;
}
