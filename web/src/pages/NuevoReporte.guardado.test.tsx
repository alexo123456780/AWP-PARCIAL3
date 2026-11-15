import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NuevoReporte from './NuevoReporte';

// IndexedDB y el canvas tienen sus propias pruebas (idb.test.ts, image.test.ts): aquí se comprueba el formulario.
const { saveReport, close, compressImage } = vi.hoisted(() => ({
  saveReport: vi.fn(),
  close: vi.fn(),
  compressImage: vi.fn(),
}));
vi.mock('../db/idb', () => ({
  openCivicGuardDB: vi.fn().mockResolvedValue({ close }),
  saveReport,
}));
vi.mock('../modules/image', () => ({ compressImage }));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMPRESSED = new Blob(['jpeg-comprimido'], { type: 'image/jpeg' });
const getCurrentPosition = vi.fn();

Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:evidencia'), revokeObjectURL: vi.fn() });

beforeEach(() => {
  compressImage.mockResolvedValue(COMPRESSED);
  saveReport.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition, watchPosition: vi.fn() },
    configurable: true,
  });
  getCurrentPosition.mockImplementation((ok: PositionCallback) =>
    ok({ coords: { latitude: 20.967, longitude: -89.623, accuracy: 8.4 } } as GeolocationPosition),
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.clearAllMocks();
});

const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar reporte' }));

async function pickPhoto() {
  fireEvent.click(screen.getByRole('button', { name: 'Tomar foto' }));
  const input = await screen.findByLabelText('Elegir o tomar una foto');
  fireEvent.change(input, {
    target: { files: [new File(['jpeg'], 'calle.jpg', { type: 'image/jpeg' })] },
  });
  await screen.findByAltText('Foto de evidencia');
}

async function fillValidReport() {
  choose('Tipo de incidencia', 'bache');
  choose('Severidad', 'alta');
  choose('Descripción', '  Bache profundo frente al mercado  ');
  fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }));
  await screen.findByText(/Lat 20\.967000/);
  await pickPhoto();
}

describe('formulario de captura', () => {
  it('cada campo tiene su etiqueta asociada y el tipo y la severidad ofrecen los valores de la API', () => {
    render(<NuevoReporte />);

    expect(screen.getByLabelText('Tipo de incidencia').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Severidad').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Descripción').tagName).toBe('TEXTAREA');
    const options = (label: string) =>
      [...screen.getByLabelText(label).querySelectorAll('option')]
        .map((option) => option.value)
        .filter(Boolean);
    expect(options('Tipo de incidencia')).toEqual([
      'bache',
      'fuga',
      'alumbrado',
      'cableado',
      'otro',
    ]);
    expect(options('Severidad')).toEqual(['baja', 'media', 'alta', 'critica']);
    expect(screen.getByRole('heading', { name: 'Ubicación' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Foto de evidencia' })).not.toBeNull();
  });

  it('con el formulario vacío muestra un mensaje por cada campo obligatorio, lleva el foco al primero y no guarda', () => {
    render(<NuevoReporte />);

    save();

    expect(screen.getByText('Elige el tipo de incidencia.')).not.toBeNull();
    expect(screen.getByText('Elige la severidad.')).not.toBeNull();
    expect(screen.getByText('Describe la incidencia.')).not.toBeNull();
    expect(screen.getByText(/Falta la ubicación/)).not.toBeNull();
    expect(screen.getByText('Agrega una foto de evidencia.')).not.toBeNull();
    const type = screen.getByLabelText('Tipo de incidencia');
    expect(document.activeElement).toBe(type);
    expect(type.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(type.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Elige el tipo de incidencia.',
    );
    expect(saveReport).not.toHaveBeenCalled();
  });

  it('una descripción en blanco no cuenta como escrita', () => {
    render(<NuevoReporte />);
    choose('Descripción', '    ');

    save();

    expect(screen.getByText('Describe la incidencia.')).not.toBeNull();
  });

  it('muestra cuántos caracteres lleva la descripción y rechaza más de 500 con un mensaje visible', () => {
    render(<NuevoReporte />);
    choose('Descripción', 'x'.repeat(501));
    expect(screen.getByText('501 de 500 caracteres')).not.toBeNull();

    save();

    expect(
      screen.getByText('La descripción admite hasta 500 caracteres y tiene 501.'),
    ).not.toBeNull();
    expect(screen.getByLabelText('Descripción').getAttribute('aria-invalid')).toBe('true');
  });

  it('acepta una descripción de exactamente 500 caracteres', async () => {
    render(<NuevoReporte />);
    choose('Tipo de incidencia', 'fuga');
    choose('Severidad', 'baja');
    choose('Descripción', 'x'.repeat(500));
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }));
    await screen.findByText(/Lat 20\.967000/);
    await pickPhoto();

    save();

    await waitFor(() => expect(saveReport).toHaveBeenCalledOnce());
    expect(screen.queryByText(/admite hasta 500/)).toBeNull();
  });

  it('un campo corregido deja de marcarse como inválido al volver a guardar', () => {
    render(<NuevoReporte />);
    save();
    expect(screen.getByLabelText('Severidad').getAttribute('aria-invalid')).toBe('true');

    choose('Severidad', 'media');
    save();

    expect(screen.getByLabelText('Severidad').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText('Elige la severidad.')).toBeNull();
  });
});

describe('guardado local', () => {
  it('comprime la foto y guarda el reporte con UUID v4, la hora de captura y los datos del GPS', async () => {
    render(<NuevoReporte />);
    await fillValidReport();
    const before = Date.now();

    save();

    await waitFor(() => expect(saveReport).toHaveBeenCalledOnce());
    const [, incident] = saveReport.mock.calls[0];
    expect(incident).toEqual({
      id: expect.stringMatching(UUID_V4),
      type: 'bache',
      severity: 'alta',
      description: 'Bache profundo frente al mercado',
      lat: 20.967,
      lng: -89.623,
      accuracy: 8.4,
      photo: COMPRESSED,
      createdAt: expect.any(String),
    });
    expect(new Date(incident.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(incident.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(compressImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('cada reporte recibe un id distinto', async () => {
    render(<NuevoReporte />);
    await fillValidReport();
    save();
    await waitFor(() => expect(saveReport).toHaveBeenCalledOnce());
    await screen.findByText(/Reporte guardado/);

    await fillValidReport();
    save();

    await waitFor(() => expect(saveReport).toHaveBeenCalledTimes(2));
    const [first, second] = saveReport.mock.calls.map(([, incident]) => incident.id);
    expect(first).not.toBe(second);
  });

  it('con una ubicación manual (sin precisión) guarda el reporte sin accuracy', async () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1 } as GeolocationPositionError),
    );
    render(<NuevoReporte />);
    choose('Tipo de incidencia', 'otro');
    choose('Severidad', 'critica');
    choose('Descripción', 'Poste caído');
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi ubicación' }));
    fireEvent.change(await screen.findByLabelText('Latitud'), { target: { value: '20.5' } });
    fireEvent.change(screen.getByLabelText('Longitud'), { target: { value: '-89.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar estas coordenadas' }));
    await pickPhoto();

    save();

    await waitFor(() => expect(saveReport).toHaveBeenCalledOnce());
    expect(saveReport.mock.calls[0][1]).toMatchObject({ lat: 20.5, lng: -89.5 });
    expect(saveReport.mock.calls[0][1].accuracy).toBeUndefined();
  });

  it('confirma el guardado y limpia el formulario, la ubicación y la foto', async () => {
    render(<NuevoReporte />);
    await fillValidReport();

    save();

    expect((await screen.findByRole('status')).textContent).toBe(
      'Reporte guardado en tu dispositivo. Se enviará solo cuando haya conexión.',
    );
    expect((screen.getByLabelText('Tipo de incidencia') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Severidad') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Descripción') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(/Lat 20\.967000/)).toBeNull();
    expect(screen.queryByAltText('Foto de evidencia')).toBeNull();
    expect(screen.getByRole('button', { name: 'Usar mi ubicación' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar reporte' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('la confirmación desaparece al empezar a editar el siguiente reporte', async () => {
    render(<NuevoReporte />);
    await fillValidReport();
    save();
    await screen.findByText(/Reporte guardado/);

    choose('Descripción', 'Otro reporte');

    expect(screen.queryByText(/Reporte guardado/)).toBeNull();
  });

  it('deshabilita el botón mientras guarda para no duplicar el reporte con un doble toque', async () => {
    let finish!: () => void;
    saveReport.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(<NuevoReporte />);
    await fillValidReport();

    save();

    const button = await screen.findByRole('button', { name: 'Guardando…' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    finish();
    await screen.findByText(/Reporte guardado/);
    expect(saveReport).toHaveBeenCalledOnce();
  });

  it('si la foto no se puede procesar avisa, conserva lo escrito y no guarda', async () => {
    compressImage.mockRejectedValue(new Error('canvas'));
    render(<NuevoReporte />);
    await fillValidReport();

    save();

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo procesar la foto/);
    expect(saveReport).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Severidad') as HTMLSelectElement).value).toBe('alta');
    expect(screen.queryByText(/Reporte guardado/)).toBeNull();
  });

  it('si no hay espacio o falla IndexedDB avisa, conserva lo escrito y permite reintentar', async () => {
    saveReport.mockRejectedValueOnce(new DOMException('cuota', 'QuotaExceededError'));
    render(<NuevoReporte />);
    await fillValidReport();

    save();

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo guardar el reporte/);
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Reporte guardado/)).toBeNull();
    expect((screen.getByLabelText('Descripción') as HTMLTextAreaElement).value).toContain('Bache');

    save();

    await screen.findByText(/Reporte guardado/);
    expect(saveReport).toHaveBeenCalledTimes(2);
  });
});
