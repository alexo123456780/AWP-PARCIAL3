import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SyncBadge } from '../components/SyncBadge';
import { getIncident, getOutboxEntry, openCivicGuardDB } from '../db/idb';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  labelOf,
} from '../modules/incident-options';
import { fetchServerReport, formatDateTime, fromLocal, type ReportItem } from '../modules/reports';

type State =
  { status: 'loading' } | { status: 'ready'; report: ReportItem } | { status: 'missing' };

// Primero IndexedDB (funciona sin red y trae la foto guardada); solo si este dispositivo no tiene el reporte se
// le pregunta al servidor (p. ej. el destino de una notificación de un reporte hecho desde otro navegador).
async function loadReport(id: string): Promise<ReportItem | null> {
  const db = await openCivicGuardDB();
  try {
    const [incident, entry] = await Promise.all([getIncident(db, id), getOutboxEntry(db, id)]);
    if (incident) return fromLocal(incident, entry);
  } finally {
    db.close();
  }
  return fetchServerReport(id);
}

export default function Detalle() {
  const { id = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [photoSrc, setPhotoSrc] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadReport(id).then(
      (report) =>
        !cancelled && setState(report ? { status: 'ready', report } : { status: 'missing' }),
      () => !cancelled && setState({ status: 'missing' }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const photo = state.status === 'ready' ? state.report.photo : undefined;
  const photoUrl = state.status === 'ready' ? state.report.photoUrl : undefined;
  useEffect(() => {
    if (!photo) {
      setPhotoSrc(photoUrl);
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPhotoSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [photo, photoUrl]);

  return (
    <>
      <h2>Detalle del reporte</h2>
      <Link className="back-link" to="/reportes">
        ← Mis reportes
      </Link>
      {state.status === 'loading' && <p role="status">Cargando el reporte…</p>}
      {state.status === 'missing' && (
        <p role="alert" className="field-error">
          No se encontró este reporte en tu dispositivo ni en el servidor.
        </p>
      )}
      {state.status === 'ready' && (
        <>
          {photoSrc ? (
            <img className="photo-preview" src={photoSrc} alt="Foto de evidencia del reporte" />
          ) : (
            <p>Este reporte no tiene foto.</p>
          )}
          <dl className="detail-list">
            <dt>Tipo</dt>
            <dd>{labelOf(INCIDENT_TYPES, state.report.type)}</dd>
            <dt>Severidad</dt>
            <dd>{labelOf(INCIDENT_SEVERITIES, state.report.severity)}</dd>
            <dt>Descripción</dt>
            <dd>{state.report.description}</dd>
            <dt>Ubicación</dt>
            <dd>
              Lat {state.report.lat.toFixed(6)}, Lng {state.report.lng.toFixed(6)}
              {state.report.accuracy !== undefined && ` (±${Math.round(state.report.accuracy)} m)`}
            </dd>
            <dt>Fecha</dt>
            <dd>{formatDateTime(state.report.createdAt)}</dd>
            <dt>Envío</dt>
            <dd>
              <SyncBadge state={state.report.sync} />
            </dd>
            <dt>Estatus</dt>
            <dd>
              {state.report.status
                ? labelOf(INCIDENT_STATUSES, state.report.status)
                : 'Aún sin estatus del servidor'}
            </dd>
          </dl>
        </>
      )}
    </>
  );
}
