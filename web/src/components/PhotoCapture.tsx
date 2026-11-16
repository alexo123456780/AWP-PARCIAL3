import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useCamera } from '../hooks/useCamera';

// Foto de evidencia (RF-4): cámara trasera con getUserMedia y, si falla, el selector del sistema.
// Las dos vías entregan un Blob por `onChange`; comprimir y guardar es del Sprint 3.
export function PhotoCapture({
  photo,
  onChange,
}: {
  photo: Blob | null;
  onChange: (photo: Blob) => void;
}) {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [notImage, setNotImage] = useState(false);
  const stream = camera.status === 'live' ? camera.stream : null;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!photo) return undefined;
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const take = () => {
    const video = videoRef.current;
    if (!video) return;
    import('../modules/camera')
      .then(({ captureFrame }) => captureFrame(video))
      .then((blob) => {
        onChange(blob);
        camera.close();
      }, camera.fail);
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // `accept="image/*"` es solo una sugerencia: en escritorio se puede elegir cualquier archivo.
    const isImage = file.type.startsWith('image/');
    setNotImage(!isImage);
    if (isImage) {
      onChange(file);
      camera.close();
    }
  };

  return (
    <>
      {previewUrl && <img className="photo-preview" src={previewUrl} alt="Foto de evidencia" />}
      {camera.status === 'live' ? (
        <>
          <video
            ref={videoRef}
            className="photo-video"
            aria-label="Vista de la cámara"
            autoPlay
            playsInline
            muted
          />
          <div className="photo-actions">
            <button type="button" className="button" onClick={take}>
              Capturar
            </button>
            <button type="button" className="button" onClick={camera.close}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="button"
          onClick={camera.open}
          disabled={camera.status === 'opening'}
        >
          {camera.status === 'opening'
            ? 'Abriendo cámara…'
            : photo
              ? 'Tomar otra foto'
              : 'Tomar foto'}
        </button>
      )}
      {camera.status === 'error' && (
        <>
          <p role="alert">{camera.error.message}</p>
          <div className="field">
            <label htmlFor="photo-file">Elegir o tomar una foto</label>
            <input
              id="photo-file"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={pick}
            />
          </div>
          {notImage && (
            <p role="alert" className="field-error">
              El archivo elegido no es una imagen.
            </p>
          )}
        </>
      )}
    </>
  );
}
