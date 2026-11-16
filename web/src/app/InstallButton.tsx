import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card } from '../ui';

// `beforeinstallprompt` solo existe en Chromium y no está en lib.dom: se declara lo que se usa.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

// Botón propio de instalación (RF-2). Sin el evento (iOS, Firefox, app ya instalada) no se muestra nada.
export function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;

    window.addEventListener(
      'beforeinstallprompt',
      (event) => {
        event.preventDefault(); // sin esto Chrome muestra su propia mini-barra en vez de dejarnos usar el botón
        setPromptEvent(event as BeforeInstallPromptEvent);
      },
      { signal },
    );
    // También cubre la instalación hecha desde el menú del navegador.
    window.addEventListener('appinstalled', () => setPromptEvent(null), { signal });

    return () => abort.abort();
  }, []);

  if (!promptEvent) return null;

  const install = () => {
    // Cada evento solo sirve una vez: si el usuario descarta el prompt, Chrome dispara otro más adelante.
    setPromptEvent(null);
    promptEvent
      .prompt()
      .catch((error) => console.error('No se pudo abrir el prompt de instalación', error));
  };

  return (
    <Card className="flex items-center justify-between gap-3 border-brand-200 bg-brand-50">
      <p className="text-sm text-brand-900">
        Instala la app para usarla como una aplicación más, incluso sin conexión.
      </p>
      <Button onClick={install} className="shrink-0">
        <Download aria-hidden="true" className="size-4" />
        Instalar CivicGuard
      </Button>
    </Card>
  );
}
