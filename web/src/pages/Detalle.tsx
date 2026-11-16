import { ArrowLeft } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SyncBadge } from '../components/SyncBadge';
import {
  getIncident,
  getOutboxEntry,
  type IncidentStatus,
  openCivicGuardDB,
  setServerStatuses,
} from '../db/idb';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  labelOf,
} from '../modules/incident-options';
import { fetchServerReport, formatDateTime, fromLocal, type ReportItem } from '../modules/reports';
import { Alert, buttonStyles, Card, Loading, PageHeader } from '../ui';

type State =
  { status: 'loading' } | { status: 'ready'; report: ReportItem } | { status: 'missing' };

// Primero IndexedDB (funciona sin red y trae la foto guardada); solo si este dispositivo no tiene el reporte se
// le pregunta al servidor (p. ej. el destino de una notificación de un reporte hecho desde otro navegador).
async function loadReport(id: string): Promise<{ report: ReportItem; local: boolean } | null> {
  const db = await openCivicGuardDB();
  try {
    const [incident, entry] = await Promise.all([getIncident(db, id), getOutboxEntry(db, id)]);
    if (incident) return { report: fromLocal(incident, entry), local: true };
  } finally {
    db.close();
  }
  const report = await fetchServerReport(id);
  return report && { report, local: false };
}

// El coordinador cambia el estatus en el servidor, y el aviso push lleva justo a este detalle: se le pregunta por el
// vigente (y se guarda para verlo sin red). Sin red, o con una copia vieja del respaldo, se queda el último conocido.
async function currentStatus(id: string): Promise<IncidentStatus | undefined> {
  const status = (await fetchServerReport(id, true))?.status;
  if (!status) return undefined;
  const db = await openCivicGuardDB();
  try {
    await setServerStatuses(db, new Map([[id, status]]));
  } finally {
    db.close();
  }
  return status;
}

export default function Detalle() {
  const { id = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [photoSrc, setPhotoSrc] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadReport(id).then(
      (found) => {
        if (cancelled) return;
        setState(found ? { status: 'ready', report: found.report } : { status: 'missing' });
        if (!found?.local) return;
        currentStatus(id).then(
          (status) =>
            status &&
            !cancelled &&
            setState((current) =>
              current.status === 'ready'
                ? { status: 'ready', report: { ...current.report, status } }
                : current,
            ),
          () => undefined, // sin lectura del servidor se queda el último estatus conocido
        );
      },
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
    <div className="space-y-4">
      <Link to="/reportes" className={buttonStyles({ variant: 'ghost' })}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver a Mis reportes
      </Link>
      <PageHeader title="Detalle del reporte" />
      {state.status === 'loading' && <Loading>Cargando el reporte…</Loading>}
      {state.status === 'missing' && (
        <Alert role="alert" tone="danger">
          No se encontró este reporte en tu dispositivo ni en el servidor.
        </Alert>
      )}
      {state.status === 'ready' && (
        <Card className="space-y-5">
          {photoSrc ? (
            <img
              className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
              src={photoSrc}
              alt="Foto de evidencia del reporte"
            />
          ) : (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Este reporte no tiene foto.
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item label="Tipo">{labelOf(INCIDENT_TYPES, state.report.type)}</Item>
            <Item label="Severidad">{labelOf(INCIDENT_SEVERITIES, state.report.severity)}</Item>
            <Item label="Descripción" wide>
              {state.report.description}
            </Item>
            <Item label="Ubicación">
              Lat {state.report.lat.toFixed(6)}, Lng {state.report.lng.toFixed(6)}
              {state.report.accuracy !== undefined && ` (±${Math.round(state.report.accuracy)} m)`}
            </Item>
            <Item label="Fecha">{formatDateTime(state.report.createdAt)}</Item>
            <Item label="Envío">
              <SyncBadge state={state.report.sync} />
            </Item>
            <Item label="Estatus">
              {state.report.status
                ? labelOf(INCIDENT_STATUSES, state.report.status)
                : 'Aún sin estatus del servidor'}
            </Item>
          </dl>
        </Card>
      )}
    </div>
  );
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{label}</dt>
      <dd className="mt-1 text-slate-900">{children}</dd>
    </div>
  );
}
