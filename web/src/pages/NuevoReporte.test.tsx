import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NuevoReporte from './NuevoReporte';

const getCurrentPosition = vi.fn();

function withGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition, watchPosition: vi.fn() },
    configurable: true,
  });
}

const gpsAnswers = (code?: number) =>
  getCurrentPosition.mockImplementation((ok: PositionCallback, fail: PositionErrorCallback) =>
    code
      ? fail({ code } as GeolocationPositionError)
      : ok({
          coords: { latitude: 20.967, longitude: -89.623, accuracy: 8.4 },
        } as GeolocationPosition),
  );

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.clearAllMocks();
});

const locate = () => fireEvent.click(screen.getByRole('button', { name: /ubicación/ }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('captura de ubicación en Nuevo reporte', () => {
  it('no pide la ubicación al cargar la pantalla', () => {
    withGeolocation();

    render(<NuevoReporte />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Latitud')).toBeNull();
  });

  it('con permiso muestra lat, lng y precisión', async () => {
    withGeolocation();
    gpsAnswers();
    render(<NuevoReporte />);

    locate();

    expect(await screen.findByText(/Lat 20\.967000, Lng -89\.623000 \(±8 m\)/)).not.toBeNull();
    expect(screen.queryByLabelText('Latitud')).toBeNull();
    expect(screen.getByRole('button', { name: 'Actualizar ubicación' })).not.toBeNull();
  });

  it.each([
    [1, /permiso/],
    [3, /10 segundos/],
  ])('si falla (código %i) muestra el motivo y el formulario manual', async (code, message) => {
    withGeolocation();
    gpsAnswers(code);
    render(<NuevoReporte />);

    locate();

    expect((await screen.findByRole('alert')).textContent).toMatch(message);
    expect(screen.getByLabelText('Latitud')).not.toBeNull();
    expect(screen.getByLabelText('Longitud')).not.toBeNull();
  });

  it('sin API de geolocalización ofrece directamente la captura manual', async () => {
    render(<NuevoReporte />);

    locate();

    expect((await screen.findByRole('alert')).textContent).toMatch(/no ofrece ubicación/);
    expect(screen.getByLabelText('Latitud')).not.toBeNull();
  });

  it('valida los rangos de la captura manual y no la acepta fuera de ellos', async () => {
    gpsAnswers(1);
    withGeolocation();
    render(<NuevoReporte />);
    locate();
    await screen.findByLabelText('Latitud');

    type('Latitud', '91');
    type('Longitud', '-181');
    fireEvent.click(screen.getByRole('button', { name: 'Usar estas coordenadas' }));

    expect(screen.getByText('La latitud debe estar entre −90 y 90.')).not.toBeNull();
    expect(screen.getByText('La longitud debe estar entre −180 y 180.')).not.toBeNull();
    expect(screen.getByLabelText('Latitud').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/Lat 91/)).toBeNull();
  });

  it('una ubicación manual válida (con coma decimal) reemplaza el formulario por las coordenadas', async () => {
    gpsAnswers(1);
    withGeolocation();
    render(<NuevoReporte />);
    locate();
    await screen.findByLabelText('Latitud');

    type('Latitud', '20,5');
    type('Longitud', '-89.5');
    fireEvent.click(screen.getByRole('button', { name: 'Usar estas coordenadas' }));

    expect(screen.getByText('Lat 20.500000, Lng -89.500000')).not.toBeNull();
    expect(screen.queryByLabelText('Latitud')).toBeNull();
  });

  it('un campo corregido deja de marcarse como inválido al reenviar', async () => {
    gpsAnswers(1);
    withGeolocation();
    render(<NuevoReporte />);
    locate();
    await screen.findByLabelText('Latitud');
    type('Latitud', 'x');
    type('Longitud', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Usar estas coordenadas' }));
    expect(screen.getByLabelText('Latitud').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Longitud').getAttribute('aria-invalid')).toBeNull();

    type('Latitud', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Usar estas coordenadas' }));

    expect(screen.queryByText(/debe estar entre/)).toBeNull();
  });
});
