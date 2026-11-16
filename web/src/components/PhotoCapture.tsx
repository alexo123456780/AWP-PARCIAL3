import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useCamera } from '../hooks/useCamera';
import { Alert, Button, Field } from '../ui';

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
    <div className="space-y-3">
      {previewUrl && (
        <img
          className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
          src={previewUrl}
          alt="Foto de evidencia"
        />
      )}
      {camera.status === 'live' ? (
        <>
          <video
            ref={videoRef}
            className="max-h-[60vh] w-full rounded-lg bg-slate-900 object-contain"
            aria-label="Vista de la cámara"
            autoPlay
            playsInline
            muted
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={take}>
              <Camera aria-hidden="true" className="size-4" />
              Capturar
            </Button>
            <Button variant="secondary" onClick={camera.close}>
              Cancelar
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant={photo ? 'secondary' : 'primary'}
          onClick={camera.open}
          disabled={camera.status === 'opening'}
        >
          <Camera aria-hidden="true" className="size-4" />
          {camera.status === 'opening'
            ? 'Abriendo cámara…'
            : photo
              ? 'Tomar otra foto'
              : 'Tomar foto'}
        </Button>
      )}
      {camera.status === 'error' && (
        <>
          <Alert role="alert" tone="warning">
            {camera.error.message}
          </Alert>
          <Field label="Elegir o tomar una foto">
            {(props) => (
              <input
                {...props}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={pick}
                className="block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:border-0 file:bg-brand-50 file:px-4 file:font-semibold file:text-brand-800"
              />
            )}
          </Field>
          {notImage && (
            <Alert role="alert" tone="danger">
              El archivo elegido no es una imagen.
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
