import { HardHat, ShieldCheck } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { Brand } from '../app/Brand';
import { PageSkeleton } from '../app/Skeleton';
import { homeOf, useSession } from '../app/session';
import { LoginForm } from '../components/LoginForm';
import { Alert, Button, Card, SectionTitle } from '../ui';

/** A dónde volver tras entrar: la ruta a la que se iba (si es del perfil que entra) o su pantalla de inicio. */
function destination(from: unknown, profile: 'operador' | 'coordinador') {
  const wanted = typeof from === 'string' ? from : '';
  const isOperatorPath = wanted === '/' || wanted.startsWith('/reportes');
  return (profile === 'operador') === isOperatorPath ? wanted : homeOf(profile);
}

/**
 * Pantalla de entrada: la única ruta pública. Se elige el perfil; sin elegirlo no existe ninguna otra pantalla. El
 * operador de campo entra sin contraseña (funciona sin red); el coordinador inicia sesión con su correo y contraseña.
 */
export default function Acceso() {
  const { profile, ready, expired, enterAsOperator, signInCoordinator } = useSession();
  const { state } = useLocation();
  const from = (state as { from?: string } | null)?.from;

  // Con un perfil ya activo (o recién elegido) esta pantalla sobra: se va a donde se iba o al inicio de ese perfil.
  if (!ready) return <PageSkeleton />;
  if (profile) return <Navigate to={destination(from, profile)} replace />;

  return (
    <div className="min-h-dvh">
      <header className="bg-brand-600 text-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Bienvenido a CivicGuard
          </h2>
          <p className="text-slate-600">Elige cómo vas a usar la aplicación.</p>
        </div>
        {expired && (
          <Alert role="status" tone="warning">
            Tu sesión venció. Inicia sesión de nuevo.
          </Alert>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-4">
            <span className="grid size-11 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <HardHat aria-hidden="true" className="size-6" />
            </span>
            <div className="space-y-1">
              <SectionTitle>Operador de campo</SectionTitle>
              <p className="text-sm text-slate-600">
                Reporta incidencias con ubicación y foto, incluso sin conexión; se envían solas al
                volver la red.
              </p>
            </div>
            <Button size="lg" block className="mt-auto" onClick={() => void enterAsOperator()}>
              Entrar como operador
            </Button>
          </Card>
          <Card className="flex flex-col gap-4">
            <span className="grid size-11 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <ShieldCheck aria-hidden="true" className="size-6" />
            </span>
            <div className="space-y-1">
              <SectionTitle>Coordinador</SectionTitle>
              <p className="text-sm text-slate-600">
                Revisa los reportes, cambia su estatus y avisa a quien los hizo. Requiere sesión.
              </p>
            </div>
            <LoginForm onLogin={signInCoordinator} />
          </Card>
        </div>
        <p className="text-center text-xs text-slate-500">
          La sesión del coordinador vive solo en esta pestaña: al cerrarla o recargarla se vuelve a
          pedir.
        </p>
      </main>
    </div>
  );
}
