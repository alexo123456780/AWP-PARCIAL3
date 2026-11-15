import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraError, captureFrame, openCamera, stopCamera } from './camera';

// jsdom no trae mediaDevices: se simula la API con la firma real de getUserMedia.
function stubMediaDevices(getUserMedia: MediaDevices['getUserMedia'] | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia && { getUserMedia },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.restoreAllMocks();
});

describe('openCamera', () => {
  it('pide la cámara trasera y devuelve el stream', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue(stream);
    stubMediaDevices(getUserMedia);

    await expect(openCamera()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: 'environment' } });
  });

  it.each(['NotAllowedError', 'PermissionDeniedError'])(
    'con %s rechaza como denied con un mensaje claro',
    async (name) => {
      stubMediaDevices(vi.fn().mockRejectedValue(new DOMException('no', name)));

      const error = await openCamera().catch((e: CameraError) => e);

      expect(error).toBeInstanceOf(CameraError);
      expect(error).toMatchObject({ reason: 'denied' });
      expect((error as CameraError).message).toMatch(/permiso/);
    },
  );

  it.each([
    new DOMException('sin cámara', 'NotFoundError'),
    new DOMException('ocupada', 'NotReadableError'),
    'algo raro',
    undefined,
  ])('con el error %j rechaza como unavailable', async (failure) => {
    stubMediaDevices(vi.fn().mockRejectedValue(failure));

    await expect(openCamera()).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it.each([
    ['sin mediaDevices (navegador viejo o contexto no seguro)', undefined],
    ['con mediaDevices sin getUserMedia', {}],
  ])('%s rechaza como unsupported', async (_caso, mediaDevices) => {
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });

    await expect(openCamera()).rejects.toMatchObject({ reason: 'unsupported' });
  });
});

describe('stopCamera', () => {
  it('detiene todos los tracks del stream', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];

    stopCamera({ getTracks: () => tracks } as unknown as MediaStream);

    tracks.forEach((track) => expect(track.stop).toHaveBeenCalledOnce());
  });
});

describe('captureFrame', () => {
  const drawImage = vi.fn();
  beforeEach(() => drawImage.mockClear());

  // jsdom no implementa canvas: getContext y toBlob se simulan sobre el prototipo.
  function stubCanvas(blob: Blob | null, context: unknown = { drawImage }) {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(blob));
    return { getContext, toBlob };
  }

  function videoOf(width: number, height: number) {
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: width });
    Object.defineProperty(video, 'videoHeight', { value: height });
    return video;
  }

  it('dibuja el fotograma a su tamaño real y lo devuelve como JPEG', async () => {
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    const { getContext, toBlob } = stubCanvas(jpeg);
    const video = videoOf(640, 480);

    await expect(captureFrame(video)).resolves.toBe(jpeg);

    const canvas = getContext.mock.contexts[0] as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0);
    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jpeg');
  });

  it('rechaza si el video aún no tiene fotogramas', async () => {
    stubCanvas(new Blob());

    await expect(captureFrame(videoOf(0, 0))).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('rechaza si el canvas no da contexto 2D', async () => {
    stubCanvas(new Blob(), null);

    await expect(captureFrame(videoOf(640, 480))).rejects.toBeInstanceOf(CameraError);
  });

  it('rechaza si el canvas no puede producir la imagen', async () => {
    stubCanvas(null);

    await expect(captureFrame(videoOf(640, 480))).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
