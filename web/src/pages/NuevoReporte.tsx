import { useState } from 'react';
import { ManualLocationForm } from '../components/ManualLocationForm';
import { PhotoCapture } from '../components/PhotoCapture';
import { useGeolocation } from '../hooks/useGeolocation';

export default function NuevoReporte() {
  const geo = useGeolocation();
  const [photo, setPhoto] = useState<Blob | null>(null);

  return (
    <>
      <h2>Nuevo reporte</h2>
      <section aria-labelledby="ubicacion-titulo">
        <h3 id="ubicacion-titulo">Ubicación</h3>
        {geo.status === 'success' && (
          <p>
            Lat {geo.position.lat.toFixed(6)}, Lng {geo.position.lng.toFixed(6)}
            {geo.position.accuracy !== undefined && ` (±${Math.round(geo.position.accuracy)} m)`}
          </p>
        )}
        <button
          type="button"
          className="button"
          onClick={geo.locate}
          disabled={geo.status === 'loading'}
        >
          {geo.status === 'loading'
            ? 'Obteniendo ubicación…'
            : geo.status === 'success'
              ? 'Actualizar ubicación'
              : 'Usar mi ubicación'}
        </button>
        {geo.status === 'error' && (
          <>
            <p role="alert">{geo.error.message}</p>
            <ManualLocationForm onSubmit={geo.setManual} />
          </>
        )}
      </section>
      <section aria-labelledby="foto-titulo">
        <h3 id="foto-titulo">Foto de evidencia</h3>
        <PhotoCapture photo={photo} onChange={setPhoto} />
      </section>
    </>
  );
}
