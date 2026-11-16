import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { deleteMeta, getMeta, openCivicGuardDB, setMeta } from '../db/idb';

export type Profile = 'operador' | 'coordinador';

/** Pantalla de inicio de cada perfil: lo único que ve al entrar. */
export const homeOf = (profile: Profile) => (profile === 'coordinador' ? '/panel' : '/');

interface SessionState {
  profile: Profile | null;
  /** JWT del coordinador: solo en memoria (RF-5), nunca en el almacenamiento del navegador. */
  token: string | null;
  email: string | null;
  /** Se terminó de leer el perfil guardado: hasta entonces las rutas esperan en vez de mandar al acceso. */
  ready: boolean;
  /** La sesión del coordinador venció (un 401): el acceso lo explica. */
  expired: boolean;
}

interface Session extends SessionState {
  enterAsOperator: () => Promise<void>;
  signInCoordinator: (token: string, email: string) => void;
  /** Cierra la sesión (coordinador) u olvida el perfil (operador); sus reportes locales no se tocan. */
  signOut: () => Promise<void>;
  expire: () => void;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Perfil activo de la app. El coordinador entra con login y su JWT vive en memoria: recargar la página lo pierde. El
 * operador de campo no tiene cuenta (funciona sin red, PRD §2): solo se recuerda que ya eligió ese perfil en IndexedDB
 * (clave `profile` del store `meta`), para que un aviso push abra directo el detalle de su reporte.
 */
export function SessionProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Solo para pruebas: arranca con un perfil sin pasar por IndexedDB. */
  initial?: Partial<Pick<SessionState, 'profile' | 'token' | 'email'>>;
}) {
  const [state, setState] = useState<SessionState>({
    profile: initial?.profile ?? null,
    token: initial?.token ?? null,
    email: initial?.email ?? null,
    ready: initial !== undefined,
    expired: false,
  });

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    (async () => {
      let saved: string | undefined;
      try {
        const db = await openCivicGuardDB();
        try {
          saved = await getMeta(db, 'profile');
        } finally {
          db.close();
        }
      } catch {
        // sin IndexedDB no se puede recordar el perfil: se entra por la pantalla de acceso
      }
      if (!cancelled) {
        setState((current) => ({
          ...current,
          profile: current.profile ?? (saved === 'operador' ? 'operador' : null),
          ready: true,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const remember = useCallback(
    async (change: (db: Awaited<ReturnType<typeof openCivicGuardDB>>) => Promise<unknown>) => {
      try {
        const db = await openCivicGuardDB();
        try {
          await change(db);
        } finally {
          db.close();
        }
      } catch {
        // recordar el perfil es un extra: sin él, la próxima vez se vuelve a elegir
      }
    },
    [],
  );

  const enterAsOperator = useCallback(async () => {
    setState((current) => ({
      ...current,
      profile: 'operador',
      token: null,
      email: null,
      expired: false,
    }));
    await remember((db) => setMeta(db, 'profile', 'operador'));
  }, [remember]);

  const signInCoordinator = useCallback((token: string, email: string) => {
    setState((current) => ({ ...current, profile: 'coordinador', token, email, expired: false }));
  }, []);

  const signOut = useCallback(async () => {
    setState((current) => ({
      ...current,
      profile: null,
      token: null,
      email: null,
      expired: false,
    }));
    await remember((db) => deleteMeta(db, 'profile'));
  }, [remember]);

  const expire = useCallback(() => {
    setState((current) => ({ ...current, profile: null, token: null, email: null, expired: true }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      // Un coordinador sin token (la sesión se perdió) no es un coordinador: cuenta como sin perfil.
      profile: state.profile === 'coordinador' && !state.token ? null : state.profile,
      enterAsOperator,
      signInCoordinator,
      signOut,
      expire,
    }),
    [state, enterAsOperator, signInCoordinator, signOut, expire],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return session;
}
