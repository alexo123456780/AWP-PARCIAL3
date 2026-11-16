import 'fake-indexeddb/auto';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMeta, openCivicGuardDB } from '../db/idb';
import { SessionProvider, useSession } from './session';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SessionProvider>{children}</SessionProvider>
);
const OPERATOR = {
  token: 'jwt-operador',
  role: 'operador',
  email: 'operador@civicguard.test',
} as const;
const COORDINATOR = {
  token: 'jwt-de-prueba',
  role: 'coordinador',
  email: 'coord@civicguard.test',
} as const;
const savedProfile = async () => {
  const db = await openCivicGuardDB();
  try {
    return await getMeta(db, 'profile');
  } finally {
    db.close();
  }
};

describe('SessionProvider', () => {
  it('arranca sin perfil y avisa cuando termina de leer lo guardado', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.ready).toBe(false);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toMatchObject({ profile: null, token: null, expired: false });
  });

  it('el operador se recuerda en IndexedDB, sin su token y fuera de localStorage, y la siguiente visita lo recupera', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const first = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(() => first.result.current.signIn(OPERATOR));
    expect(first.result.current).toMatchObject({
      profile: 'operador',
      token: null, // sirve solo para entrar: sin red no se puede renovar, así que no se conserva
      email: OPERATOR.email,
    });
    expect(await savedProfile()).toBe('operador');
    expect(write).not.toHaveBeenCalled();
    first.unmount();

    const second = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.profile).toBe('operador');
  });

  it('el coordinador y su token solo viven en memoria: nada se guarda y al recargar se pierde', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const first = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(first.result.current.ready).toBe(true));

    await act(() => first.result.current.signIn(COORDINATOR));

    expect(first.result.current).toMatchObject({
      profile: 'coordinador',
      token: 'jwt-de-prueba',
      email: 'coord@civicguard.test',
    });
    expect(await savedProfile()).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    first.unmount();

    const second = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current).toMatchObject({ profile: null, token: null });
  });

  it('signOut olvida el perfil guardado y limpia la sesión', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signIn(OPERATOR));

    await act(() => result.current.signOut());

    expect(result.current.profile).toBeNull();
    expect(await savedProfile()).toBeUndefined();
  });

  it('expire (un 401) cierra la sesión del coordinador y deja la marca para explicarlo en el acceso', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signIn({ ...COORDINATOR, token: 'jwt-vencido' }));

    act(() => result.current.expire());

    expect(result.current).toMatchObject({
      profile: null,
      token: null,
      email: null,
      expired: true,
    });
  });

  it('si IndexedDB falla no se queda cargando: queda listo y sin perfil', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB bloqueada');
    });
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.profile).toBeNull();
    await act(() => result.current.signIn(OPERATOR)); // no lanza: solo no se recuerda
    expect(result.current.profile).toBe('operador');
  });

  it('useSession fuera de un SessionProvider lanza un error claro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Probe = () => <p>{useSession().profile}</p>;

    expect(() => render(<Probe />)).toThrow('useSession debe usarse dentro de <SessionProvider>');
    expect(screen.queryByText('operador')).toBeNull();
  });
});
