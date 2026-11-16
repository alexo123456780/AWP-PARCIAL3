import { Bell } from 'lucide-react';
import { usePush } from '../hooks/usePush';
import { Alert, Button, Card } from '../ui';

// Avisos de cambio de estatus (HU-07). Sin soporte de push no hay botón, solo la explicación (R3); el resto de la app
// no depende de esto.
export function PushButton() {
  const { state, enable } = usePush();

  switch (state.status) {
    case 'unsupported':
      return (
        <Alert tone="info">
          Este navegador no admite avisos, así que no recibirás notificaciones cuando cambie el
          estatus de tus reportes: consúltalos aquí. En iPhone se necesita iOS 16.4 o superior y
          añadir la app a la pantalla de inicio.
        </Alert>
      );
    case 'enabled':
      return (
        <Alert role="status" tone="success">
          Avisos activados: te notificaremos cuando cambie el estatus de tus reportes.
        </Alert>
      );
    case 'denied':
      return (
        <Alert role="status" tone="warning">
          Las notificaciones están bloqueadas, así que no recibirás avisos. Puedes permitirlas en la
          configuración del sitio en tu navegador; mientras tanto, consulta el estatus aquí.
        </Alert>
      );
    case 'unavailable':
      return (
        <Alert role="status" tone="warning">
          Los avisos no están disponibles por ahora. Consulta el estatus de tus reportes aquí.
        </Alert>
      );
    default:
      return (
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <Bell aria-hidden="true" className="size-5" />
            </span>
            <p className="text-sm text-slate-700">
              Entérate cuando el coordinador cambie el estatus de un reporte, sin abrir la app.
            </p>
          </div>
          {state.status === 'error' && (
            <Alert role="alert" tone="danger">
              No se pudieron activar los avisos. Revisa tu conexión e inténtalo de nuevo.
            </Alert>
          )}
          <Button onClick={() => void enable()} disabled={state.status === 'working'}>
            {state.status === 'working' ? 'Activando avisos…' : 'Activar avisos'}
          </Button>
        </Card>
      );
  }
}
