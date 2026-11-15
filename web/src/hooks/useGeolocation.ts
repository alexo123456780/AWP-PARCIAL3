import { useCallback, useState } from 'react';
import { type Coordinates, GeoError, getPosition } from '../modules/geo';

export type GeoState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; position: Coordinates }
  | { status: 'error'; error: GeoError };

// No consulta nada al montarse: la ubicación se pide solo al llamar a `locate` (RF-4, sin rastreo continuo).
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });

  const locate = useCallback(() => {
    setState({ status: 'loading' });
    getPosition().then(
      (position) => setState({ status: 'success', position }),
      (error: GeoError) => setState({ status: 'error', error }),
    );
  }, []);

  // Ubicación escrita a mano cuando el GPS falla (HU-11): queda en el mismo estado que la del GPS.
  const setManual = useCallback(
    (position: Coordinates) => setState({ status: 'success', position }),
    [],
  );

  return { ...state, locate, setManual };
}
