import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCivicGuardDB, saveReport, type IncidentRecord } from '../db/idb';
import Detalle from './Detalle';

vi.mock('../modules/sync', () => ({ API_URL: 'https://api.civicguard.test' }));

const ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const createObjectURL = vi.fn(() => 'blob:foto-local');
const revokeObjectURL = vi.fn();
Object.assign(URL, { createObjectURL, revokeObjectURL });

const incident = (extra: Partial<IncidentRecord> = {}): IncidentRecord => ({
  id: ID,
  type: 'alumbrado',
  severity: 'media',
  description: 'Poste sin luz frente a la escuela',
  lat: 20.967,
  lng: -89.623,
  accuracy: 8.4,
  createdAt: '2026-11-20T10:00:00.000Z',
  ...extra,
});

async function seed(item: IncidentRecord) {
  const db = await openCivicGuardDB();
  await saveReport(db, item);
  db.close();
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reportes" element={<p>lista</p>} />
        <Route path="/reportes/:id" element={<Detalle />} />
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
  vi.clearAllMocks();
});

const field = (label: string) => screen.getByText(label).nextElementSibling!.textContent;

describe('Detalle del reporte', () => {
  it('abierto por su ruta muestra tipo, severidad, descripción, ubicación, fecha, estado de envío y estatus, sin red', async () => {
    await seed(incident({ status: 'en_revision' }));

    renderAt(`/reportes/${ID}`);

    expect(await screen.findByText('Poste sin luz frente a la escuela')).not.toBeNull();
    expect(field('Tipo')).toBe('Alumbrado');
    expect(field('Severidad')).toBe('Media');
    expect(field('Ubicación')).toBe('Lat 20.967000, Lng -89.623000 (±8 m)');
    expect(field('Fecha')).toMatch(/2026/);
    expect(field('Envío')).toMatch(/Pendiente/);
    expect(field('Estatus')).toBe('En revisión');
    expect(screen.getByRole('heading', { name: 'Detalle del reporte' })).not.toBeNull();
  });

  it('muestra la foto guardada en el dispositivo y libera su URL al salir', async () => {
    await seed(incident({ photo: new Blob(['jpeg'], { type: 'image/jpeg' }) }));

    const { unmount } = renderAt(`/reportes/${ID}`);

    const photo = await screen.findByAltText('Foto de evidencia del reporte');
    expect(photo.getAttribute('src')).toBe('blob:foto-local');
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:foto-local');
  });

  it('sin foto lo dice; sin estatus del servidor lo dice; sin precisión (captura manual) no la inventa', async () => {
    await seed(incident({ accuracy: undefined }));

    renderAt(`/reportes/${ID}`);

    expect(await screen.findByText('Este reporte no tiene foto.')).not.toBeNull();
    expect(field('Estatus')).toBe('Aún sin estatus del servidor');
    expect(field('Ubicación')).toBe('Lat 20.967000, Lng -89.623000');
  });

  it('un reporte que este dispositivo no tiene se pide al servidor, con su foto remota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'remoto',
            type: 'fuga',
            severity: 'alta',
            description: 'Fuga grande',
            lat: 1,
            lng: 2,
            accuracy: null,
            photo_url: 'https://storage.test/remoto.jpg',
            status: 'resuelto',
            created_at: '2026-11-20T10:00:00.000Z',
          }),
        ),
      ),
    );

    renderAt('/reportes/remoto');

    expect((await screen.findByAltText('Foto de evidencia del reporte')).getAttribute('src')).toBe(
      'https://storage.test/remoto.jpg',
    );
    expect(field('Estatus')).toBe('Resuelto');
    expect(field('Envío')).toMatch(/Enviado/);
  });

  it('si no está ni en el dispositivo ni en el servidor lo avisa y deja volver a la lista', async () => {
    renderAt('/reportes/no-existe');

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se encontró este reporte/);
    expect(screen.getByRole('link', { name: '← Mis reportes' }).getAttribute('href')).toBe(
      '/reportes',
    );
  });

  it('si IndexedDB falla lo trata como no encontrado, sin quedarse cargando', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB bloqueada');
    });

    renderAt(`/reportes/${ID}`);

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se encontró/);
  });

  it('cambiar de reporte carga el nuevo y no deja datos del anterior', async () => {
    await seed(incident());
    await seed(incident({ id: 'otro-id', description: 'Otro reporte distinto' }));
    render(
      <MemoryRouter initialEntries={[`/reportes/${ID}`]}>
        <Link to="/reportes/otro-id">ir al otro</Link>
        <Routes>
          <Route path="/reportes/:id" element={<Detalle />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Poste sin luz frente a la escuela');

    fireEvent.click(screen.getByRole('link', { name: 'ir al otro' }));

    expect(await screen.findByText('Otro reporte distinto')).not.toBeNull();
    expect(screen.queryByText('Poste sin luz frente a la escuela')).toBeNull();
  });
});
