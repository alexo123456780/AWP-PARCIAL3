import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.restoreAllMocks();
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

describe('foto de evidencia en Nuevo reporte', () => {
  const getUserMedia = vi.fn();

  function withCamera() {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
  }

  // Un stream con dos tracks (video y, p. ej., un sensor): todos deben detenerse.
  function fakeStream() {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
  }
  const allStopped = (tracks: { stop: ReturnType<typeof vi.fn> }[]) =>
    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());

  // jsdom no implementa video, canvas ni URL de blobs.
  function withCanvas(blob: Blob | null = new Blob(['jpeg'], { type: 'image/jpeg' }), width = 640) {
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      value: width,
      configurable: true,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      value: 480,
      configurable: true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(blob));
    return blob;
  }
  const createObjectURL = vi.fn(() => 'blob:evidencia');
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });

  const takePhoto = () => fireEvent.click(screen.getByRole('button', { name: 'Tomar foto' }));

  it('no abre la cámara al cargar la pantalla', () => {
    withCamera();

    render(<NuevoReporte />);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Vista de la cámara')).toBeNull();
    expect(screen.queryByLabelText('Elegir o tomar una foto')).toBeNull();
  });

  it('con permiso abre la cámara trasera, captura un fotograma y suelta la cámara', async () => {
    const { tracks, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    withCamera();
    const jpeg = withCanvas();
    render(<NuevoReporte />);

    takePhoto();

    expect(await screen.findByLabelText('Vista de la cámara')).not.toBeNull();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capturar' }));

    const preview = await screen.findByAltText('Foto de evidencia');
    expect(preview.getAttribute('src')).toBe('blob:evidencia');
    expect(createObjectURL).toHaveBeenCalledWith(jpeg);
    expect(screen.queryByLabelText('Vista de la cámara')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tomar otra foto' })).not.toBeNull();
    allStopped(tracks);
  });

  it('al cancelar suelta la cámara y no deja foto', async () => {
    const { tracks, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    withCamera();
    render(<NuevoReporte />);
    takePhoto();
    await screen.findByLabelText('Vista de la cámara');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    allStopped(tracks);
    expect(screen.queryByLabelText('Vista de la cámara')).toBeNull();
    expect(screen.queryByAltText('Foto de evidencia')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tomar foto' })).not.toBeNull();
  });

  it('al salir de la pantalla con la cámara abierta suelta la cámara', async () => {
    const { tracks, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    withCamera();
    const { unmount } = render(<NuevoReporte />);
    takePhoto();
    await screen.findByLabelText('Vista de la cámara');

    unmount();

    allStopped(tracks);
  });

  it('si se sale antes de responder el permiso, el stream que llega después se suelta', async () => {
    const { tracks, stream } = fakeStream();
    let grant: (stream: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)));
    withCamera();
    const { unmount } = render(<NuevoReporte />);
    takePhoto();
    expect(screen.getByRole('button', { name: 'Abriendo cámara…' })).toHaveProperty(
      'disabled',
      true,
    );

    unmount();
    grant(stream);

    await waitFor(() => allStopped(tracks));
  });

  it('con el permiso denegado explica el motivo, ofrece el selector y no bloquea el formulario', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    withCamera();
    render(<NuevoReporte />);

    takePhoto();

    expect((await screen.findByRole('alert')).textContent).toMatch(/permiso/);
    const input = screen.getByLabelText('Elegir o tomar una foto');
    expect(input.getAttribute('type')).toBe('file');
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(screen.getByRole('button', { name: 'Usar mi ubicación' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('sin getUserMedia ofrece directamente el selector', async () => {
    render(<NuevoReporte />);

    takePhoto();

    expect((await screen.findByRole('alert')).textContent).toMatch(/no permite abrir la cámara/);
    expect(screen.getByLabelText('Elegir o tomar una foto')).not.toBeNull();
  });

  it('una imagen elegida con el selector queda como la foto, igual que la captura directa', async () => {
    render(<NuevoReporte />);
    takePhoto();
    const input = await screen.findByLabelText('Elegir o tomar una foto');
    const file = new File(['png'], 'calle.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [file] } });

    expect((await screen.findByAltText('Foto de evidencia')).getAttribute('src')).toBe(
      'blob:evidencia',
    );
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.queryByLabelText('Elegir o tomar una foto')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tomar otra foto' })).not.toBeNull();
  });

  it('un archivo que no es imagen se rechaza con un aviso y no cambia la foto', async () => {
    render(<NuevoReporte />);
    takePhoto();
    const input = await screen.findByLabelText('Elegir o tomar una foto');

    fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'oficio.pdf', { type: 'application/pdf' })] },
    });

    expect(screen.getByText('El archivo elegido no es una imagen.')).not.toBeNull();
    expect(screen.queryByAltText('Foto de evidencia')).toBeNull();
  });

  it('si no se puede capturar el fotograma suelta la cámara y ofrece el selector', async () => {
    const { tracks, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    withCamera();
    withCanvas(new Blob(), 0);
    render(<NuevoReporte />);
    takePhoto();
    await screen.findByLabelText('Vista de la cámara');

    fireEvent.click(screen.getByRole('button', { name: 'Capturar' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo abrir la cámara/);
    expect(screen.getByLabelText('Elegir o tomar una foto')).not.toBeNull();
    expect(screen.queryByLabelText('Vista de la cámara')).toBeNull();
    allStopped(tracks);
  });
});
