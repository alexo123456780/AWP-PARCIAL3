import { ClipboardList, FilePlus2, LogOut, type LucideIcon } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Button, cn } from '../ui';
import { Brand } from './Brand';
import { InstallButton } from './InstallButton';
import { Skeleton } from './Skeleton';
import { useSession } from './session';

const OPERATOR_LINKS: {
  to: string;
  label: string;
  end?: boolean;
  icon: LucideIcon;
}[] = [
  { to: '/', label: 'Nuevo reporte', end: true, icon: FilePlus2 },
  { to: '/reportes', label: 'Mis reportes', icon: ClipboardList },
];

/**
 * Marco de toda pantalla autenticada: encabezado con el perfil activo y «Salir», navegación SOLO con las rutas de ese
 * perfil, avisos de la app (actualización, instalación) y el contenido de la ruta. El encabezado ocupa lo mismo que
 * el del cascarón estático de index.html, para que no haya salto al montar React.
 */
export function AppShell({ wide = false }: { wide?: boolean }) {
  const { profile, signOut } = useSession();
  const links = profile === 'operador' ? OPERATOR_LINKS : [];

  return (
    <div className="min-h-dvh">
      <a
        href="#contenido"
        className="visually-hidden focus:not-visually-hidden fixed top-2 left-2 z-50 rounded-lg bg-white px-4 py-2 font-semibold text-brand-700 shadow-lg"
      >
        Saltar al contenido
      </a>
      <header className="bg-brand-600 text-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Brand />
          <div className="flex items-center gap-2">
            <Badge tone="brand" className="bg-white/15 text-white">
              {profile === 'coordinador' ? 'Coordinador' : 'Operador de campo'}
            </Badge>
            <Button
              variant="ghost"
              onClick={() => void signOut()}
              className="text-white hover:bg-white/15 hover:text-white focus-visible:outline-white active:bg-white/25"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Salir
            </Button>
          </div>
        </div>
      </header>
      {links.length > 0 && (
        <nav aria-label="Principal" className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl px-2">
            {links.map(({ to, label, end, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-12 flex-1 items-center justify-center gap-2 border-b-2 px-3 text-sm font-semibold sm:flex-none sm:px-5',
                    isActive
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      <main
        id="contenido"
        className={cn('mx-auto w-full space-y-4 px-4 py-6', wide ? 'max-w-5xl' : 'max-w-2xl')}
      >
        <InstallButton />
        <Suspense fallback={<Skeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
