import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCivicGuardDB, saveReport, type IncidentRecord } from '../db/idb';
import MisReportes from './MisReportes';

vi.mock('../modules/sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const report = (
  id: string,
  createdAt: string,
  extra: Partial<IncidentRecord> = {},
): IncidentRecord => ({
  id,
  type: 'bache',
  severity: 'alta',
  description: `Descripción de ${id}`,
  lat: 20.9,
  lng: -89.6,
  createdAt,
  ...extra,
});

async function seed(reports: IncidentRecord[], states: Record<string, 'sent' | 'error'> = {}) {
  const db = await openCivicGuardDB();
  for (const item of reports) {
    await saveReport(db, item);
    if (states[item.id])
      await db.put('outbox', { id: item.id, status: states[item.id], createdAt: item.createdAt });
  }
  db.close();
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/reportes']}>
      <Routes>
        <Route path="/reportes" element={<MisReportes />} />
        <Route path="/reportes/:id" element={<p>página de detalle</p>} />
        <Route path="/" element={<p>nuevo reporte</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Mis reportes', () => {
  it('lista los reportes locales con su tipo, severidad, fecha, descripción y estado, sin red', async () => {
    await seed(
      [
        report('a', '2026-11-20T10:00:00.000Z'),
        report('b', '2026-11-20T11:00:00.000Z', { type: 'fuga', severity: 'critica' }),
        report('c', '2026-11-20T12:00:00.000Z'),
      ],
      { b: 'sent', c: 'error' },
    );

    renderPage();

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Del más reciente al más antiguo
    expect(within(items[0]).getByText('Con error')).not.toBeNull();
    expect(within(items[1]).getByText('Fuga · Crítica')).not.toBeNull();
    expect(within(items[1]).getByText('Enviado')).not.toBeNull();
    expect(within(items[2]).getByText('Bache · Alta')).not.toBeNull();
    expect(within(items[2]).getByText('Pendiente')).not.toBeNull();
    expect(within(items[2]).getByText('Descripción de a')).not.toBeNull();
  });

  it('el estado se dice con texto y con ícono, no solo con color', async () => {
    await seed(
      [
        report('a', '2026-11-20T10:00:00.000Z'),
        report('b', '2026-11-20T11:00:00.000Z'),
        report('c', '2026-11-20T12:00:00.000Z'),
      ],
      { b: 'sent', c: 'error' },
    );

    renderPage();

    const badges = (await screen.findAllByText(/Pendiente|Enviado|Con error/)).map((badge) =>
      badge.textContent!.trim(),
    );
    expect(badges.sort()).toEqual(['✓ Enviado', '⏳ Pendiente', '⚠ Con error'].sort());
    // El ícono es decorativo: un lector de pantalla lee solo la palabra.
    for (const icon of document.querySelectorAll('.sync-badge > span')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('cada reporte es un enlace al detalle, usable con teclado', async () => {
    await seed([report('3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', '2026-11-20T10:00:00.000Z')]);

    renderPage();

    const link = await screen.findByRole('link', { name: /Bache · Alta/ });
    expect(link.getAttribute('href')).toBe('/reportes/3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b');
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('con reportes del servidor y locales muestra la unión; los del servidor entran como enviados', async () => {
    await seed([report('local', '2026-11-20T10:00:00.000Z')]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 'remoto',
              type: 'fuga',
              severity: 'baja',
              description: 'Del servidor',
              lat: 1,
              lng: 2,
              accuracy: null,
              photo_url: null,
              status: 'recibido',
              created_at: '2026-11-21T10:00:00.000Z',
            },
          ]),
        ),
      ),
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    const [remote, local] = screen.getAllByRole('listitem');
    expect(within(remote).getByText('Del servidor')).not.toBeNull();
    expect(within(remote).getByText('Enviado')).not.toBeNull();
    expect(within(local).getByText('Pendiente')).not.toBeNull();
  });

  it('avisa cuando muestra la última copia guardada del servidor', async () => {
    await seed([report('a', '2026-11-20T10:00:00.000Z')]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('[]', { headers: { 'X-Served-From': 'cache' } })),
    );

    renderPage();

    const notice = await screen.findByText(/se muestran los datos guardados/);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toMatch(/Sin conexión/);
  });

  it('sin reportes invita a crear el primero', async () => {
    renderPage();

    expect(await screen.findByText(/Aún no tienes reportes/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Crea el primero' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('muestra «cargando» mientras lee IndexedDB', () => {
    // Una apertura que nunca termina: la pantalla debe seguir en «cargando», no mostrar una lista vacía.
    vi.spyOn(indexedDB, 'open').mockReturnValue(new IDBOpenDBRequest());

    renderPage();

    expect(screen.getByRole('status').textContent).toMatch(/Cargando/);
    expect(screen.queryByText(/Aún no tienes reportes/)).toBeNull();
  });

  it('si IndexedDB falla muestra un error claro en vez de quedarse cargando', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB bloqueada');
    });

    renderPage();

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /No se pudieron leer los reportes/,
    );
  });
});
