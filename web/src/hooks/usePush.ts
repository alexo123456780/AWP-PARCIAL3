import { useCallback, useEffect, useState } from 'react';
import { enablePush, hasPushSubscription, isPushSupported } from '../modules/push';

export type PushState =
  | { status: 'unsupported' }
  /** Se puede activar: aún no hay permiso ni suscripción. */
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'enabled' }
  /** El usuario rechazó (o ya tenía bloqueadas) las notificaciones. */
  | { status: 'denied' }
  /** El servidor no tiene push configurado. */
  | { status: 'unavailable' }
  | { status: 'error' };

const initialState = (): PushState => {
  if (!isPushSupported()) return { status: 'unsupported' };
  return { status: Notification.permission === 'denied' ? 'denied' : 'idle' };
};

/**
 * Estado de los avisos push y la acción para activarlos. No pide nada al montarse: solo lee si el dispositivo ya
 * estaba suscrito; el permiso se pide en `enable`, que debe llamarse desde un clic.
 */
export function usePush() {
  const [state, setState] = useState<PushState>(initialState);

  useEffect(() => {
    if (!isPushSupported()) return;
    let cancelled = false;
    hasPushSubscription().then(
      (subscribed) => !cancelled && subscribed && setState({ status: 'enabled' }),
      () => undefined, // sin lectura el botón sigue disponible
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(() => {
    // Sin `await` antes: `requestPermission` tiene que arrancar dentro del gesto del clic.
    const result = enablePush();
    setState({ status: 'working' });
    return result.then(
      (outcome) => setState({ status: outcome }),
      () => setState({ status: 'error' }),
    );
  }, []);

  return { state, enable };
}
