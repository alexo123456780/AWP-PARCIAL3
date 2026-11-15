import { ManualLocationForm } from '../components/ManualLocationForm';
import { useGeolocation } from '../hooks/useGeolocation';

export default function NuevoReporte() {
  const geo = useGeolocation();

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
    </>
  );
}
