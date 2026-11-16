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
  /** Activa el perfil de la cuenta que inició sesión (`role` lo dice el servidor). */
  signIn: (login: { token: string; role: Profile; email: string }) => Promise<void>;
  /** Cierra la sesión (coordinador) u olvida el perfil (operador); sus reportes locales no se tocan. */
  signOut: () => Promise<void>;
  expire: () => void;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Perfil activo de la app, que sale del rol de la cuenta con la que se inició sesión. El JWT del coordinador vive en
 * memoria: recargar la página lo pierde. El operador de campo tiene que trabajar sin red (PRD §2) y su token no sirve
 * sin conexión, así que tras iniciar sesión una vez solo se recuerda su perfil en IndexedDB (clave `profile` del store
 * `meta`, sin token ni contraseña): la app abre sin red y un aviso push lleva directo al detalle de su reporte.
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

  const signIn = useCallback(
    async ({ token, role, email }: { token: string; role: Profile; email: string }) => {
      setState((current) => ({
        ...current,
        profile: role,
        token: role === 'coordinador' ? token : null,
        email,
        expired: false,
      }));
      if (role === 'operador') await remember((db) => setMeta(db, 'profile', 'operador'));
    },
    [remember],
  );

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
      signIn,
      signOut,
      expire,
    }),
    [state, signIn, signOut, expire],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return session;
}
