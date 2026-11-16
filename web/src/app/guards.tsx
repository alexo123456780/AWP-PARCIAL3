import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PageSkeleton } from './Skeleton';
import { homeOf, type Profile, useSession } from './session';

/**
 * Deja pasar solo al perfil indicado. Sin perfil manda a la pantalla de acceso (recordando a dónde iba, p. ej. el
 * detalle al que lleva un aviso push); con el otro perfil lo manda a su propia pantalla de inicio. Una ruta que
 * no es de tu perfil no existe para ti: no hay enlaces ni atajos hacia ella.
 */
export function RequireProfile({ profile }: { profile: Profile }) {
  const session = useSession();
  const location = useLocation();

  if (!session.ready) return <PageSkeleton />;
  if (session.profile === profile) return <Outlet />;
  if (session.profile) return <Navigate to={homeOf(session.profile)} replace />;
  return <Navigate to="/acceso" replace state={{ from: location.pathname + location.search }} />;
}
