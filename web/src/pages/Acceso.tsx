import { ShieldCheck } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { Brand } from '../app/Brand';
import { PageSkeleton } from '../app/Skeleton';
import { homeOf, useSession } from '../app/session';
import { LoginForm } from '../components/LoginForm';
import { Alert, Card, SectionTitle } from '../ui';

/** A dónde volver tras entrar: la ruta a la que se iba (si es del perfil que entra) o su pantalla de inicio. */
function destination(from: unknown, profile: 'operador' | 'coordinador') {
  const wanted = typeof from === 'string' ? from : '';
  const isOperatorPath = wanted === '/' || wanted.startsWith('/reportes');
  return (profile === 'operador') === isOperatorPath ? wanted : homeOf(profile);
}

/**
 * Pantalla de entrada: la única ruta pública. Un solo inicio de sesión para todas las cuentas: el rol de la cuenta
 * (operador de campo o coordinador) decide qué pantallas se abren; sin iniciar sesión no existe ninguna otra.
 */
export default function Acceso() {
  const { profile, ready, expired, signIn } = useSession();
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
      <main className="mx-auto w-full max-w-md space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Bienvenido a CivicGuard
          </h2>
          <p className="text-slate-600">
            Entra con tu cuenta de operador de campo o de coordinador.
          </p>
        </div>
        {expired && (
          <Alert role="status" tone="warning">
            Tu sesión venció. Inicia sesión de nuevo.
          </Alert>
        )}
        <Card className="flex flex-col gap-4">
          <span className="grid size-11 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </span>
          <SectionTitle>Iniciar sesión</SectionTitle>
          <LoginForm onLogin={signIn} />
        </Card>
        <p className="text-center text-xs text-slate-500">
          El operador de campo queda recordado en este dispositivo y sigue funcionando sin conexión.
          La sesión del coordinador vive solo en esta pestaña: al recargarla se vuelve a pedir.
        </p>
      </main>
    </div>
  );
}
