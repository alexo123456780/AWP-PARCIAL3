import { usePush } from '../hooks/usePush';

// Avisos de cambio de estatus (HU-07). Sin soporte de push no hay botón, solo la explicación (R3); el resto de la app
// no depende de esto.
export function PushButton() {
  const { state, enable } = usePush();

  switch (state.status) {
    case 'unsupported':
      return (
        <p className="push-note">
          Este navegador no admite avisos, así que no recibirás notificaciones cuando cambie el
          estatus de tus reportes: consúltalos aquí. En iPhone se necesita iOS 16.4 o superior y
          añadir la app a la pantalla de inicio.
        </p>
      );
    case 'enabled':
      return (
        <p className="push-note" role="status">
          Avisos activados: te notificaremos cuando cambie el estatus de tus reportes.
        </p>
      );
    case 'denied':
      return (
        <p className="push-note" role="status">
          Las notificaciones están bloqueadas, así que no recibirás avisos. Puedes permitirlas en la
          configuración del sitio en tu navegador; mientras tanto, consulta el estatus aquí.
        </p>
      );
    case 'unavailable':
      return (
        <p className="push-note" role="status">
          Los avisos no están disponibles por ahora. Consulta el estatus de tus reportes aquí.
        </p>
      );
    default:
      return (
        <div className="push-note">
          <button
            type="button"
            className="button"
            onClick={() => void enable()}
            disabled={state.status === 'working'}
          >
            {state.status === 'working' ? 'Activando avisos…' : 'Activar avisos'}
          </button>
          {state.status === 'error' && (
            <p role="alert" className="field-error">
              No se pudieron activar los avisos. Revisa tu conexión e inténtalo de nuevo.
            </p>
          )}
        </div>
      );
  }
}
