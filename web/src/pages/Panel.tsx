import { ArrowLeft, Inbox } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { StaticMap } from '../components/StaticMap';
import type { IncidentStatus } from '../db/idb';
import {
  AdminError,
  describeFailure,
  fetchAdminIncidents,
  updateIncidentStatus,
} from '../modules/admin';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  labelOf,
} from '../modules/incident-options';
import { formatDateTime, type ServerIncident } from '../modules/reports';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  controlStyles,
  EmptyState,
  Field,
  Loading,
  PageHeader,
  SectionTitle,
} from '../ui';
// Radix AlertDialog solo se usa aquí: se importa directo para que viaje en el chunk del panel y no en el JS inicial.
import { ConfirmDialog } from '../ui/ConfirmDialog';

type Tone = 'neutral' | 'warning' | 'brand' | 'success';
const STATUS_TONE: Record<IncidentStatus, Tone> = {
  recibido: 'neutral',
  en_revision: 'warning',
  en_atencion: 'brand',
  resuelto: 'success',
};

const StatusBadge = ({ status }: { status: IncidentStatus }) => (
  <Badge tone={STATUS_TONE[status]}>{labelOf(INCIDENT_STATUSES, status)}</Badge>
);

// Panel del coordinador (HU-09, RF-9). Solo llega aquí quien inició sesión (ver guards.tsx); su JWT vive únicamente en
// la sesión en memoria: recargar o cerrar la página lo pierde y obliga a entrar de nuevo (RF-5).
export default function Panel() {
  const { token, expire } = useSession();
  return token ? <Reports token={token} onExpired={expire} /> : null;
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: ServerIncident[] };

function Reports({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [filter, setFilter] = useState<IncidentStatus | ''>('');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [selected, setSelected] = useState<ServerIncident | null>(null);
  // Solo vale la última petición: cambiar el filtro rápido no deja que una respuesta vieja pise a la nueva.
  const latest = useRef(0);

  // Un 401 devuelve al acceso; cualquier otro fallo se muestra en el sitio con la opción de reintentar.
  const handleFailure = useCallback(
    (error: unknown) => {
      if (error instanceof AdminError && error.reason === 'unauthorized') onExpired();
      else setLoaded({ status: 'error', message: describeFailure(error) });
    },
    [onExpired],
  );

  const load = useCallback(
    (status: IncidentStatus | '') => {
      const request = ++latest.current;
      setLoaded({ status: 'loading' });
      fetchAdminIncidents(token, status || undefined).then(
        (items) => request === latest.current && setLoaded({ status: 'ready', items }),
        (error) => request === latest.current && handleFailure(error),
      );
    },
    [token, handleFailure],
  );

  useEffect(() => load(filter), [load, filter]);

  if (selected) {
    return (
      <IncidentDetail
        key={selected.id}
        incident={selected}
        token={token}
        onChanged={setSelected}
        onFailure={handleFailure}
        // Al volver, la lista se pide de nuevo: refleja el estatus nuevo y respeta el filtro activo.
        onBack={() => {
          setSelected(null);
          load(filter);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Panel del coordinador"
        description="Revisa los reportes y avanza su estatus."
      />
      <div role="group" aria-label="Filtrar por estatus" className="flex flex-wrap gap-2">
        {[{ value: '' as const, label: 'Todos' }, ...INCIDENT_STATUSES].map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors',
              filter === value
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {loaded.status === 'loading' && <Loading>Cargando reportes…</Loading>}
      {loaded.status === 'error' && (
        <Alert role="alert" tone="danger">
          <p>{loaded.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => load(filter)}>
            Reintentar
          </Button>
        </Alert>
      )}
      {loaded.status === 'ready' &&
        (loaded.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={`No hay reportes${filter ? ` con estatus «${labelOf(INCIDENT_STATUSES, filter)}»` : ''}.`}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {loaded.items.map((incident) => (
              <li key={incident.id}>
                <button
                  type="button"
                  onClick={() => setSelected(incident)}
                  className="block min-h-11 w-full cursor-pointer space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {labelOf(INCIDENT_TYPES, incident.type)} ·{' '}
                      {labelOf(INCIDENT_SEVERITIES, incident.severity)}
                    </span>
                    <span className="text-sm text-slate-600">
                      {formatDateTime(incident.created_at)}
                    </span>
                  </span>
                  <span className="line-clamp-2 block text-sm text-slate-700">
                    {incident.description}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    Estatus: <StatusBadge status={incident.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

function IncidentDetail({
  incident,
  token,
  onChanged,
  onFailure,
  onBack,
}: {
  incident: ServerIncident;
  token: string;
  onChanged: (updated: ServerIncident) => void;
  onFailure: (error: unknown) => void;
  onBack: () => void;
}) {
  const [next, setNext] = useState<IncidentStatus>(incident.status);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const nextLabel = labelOf(INCIDENT_STATUSES, next);
  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateIncidentStatus(token, incident.id, next);
      onChanged(updated);
      setMessage({ kind: 'ok', text: `Estatus actualizado a «${nextLabel}».` });
    } catch (error) {
      if (error instanceof AdminError && error.reason === 'unauthorized') return onFailure(error);
      setMessage({ kind: 'error', text: describeFailure(error) });
    }
    setSaving(false);
    setConfirming(false);
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver a la lista
      </Button>
      <PageHeader title="Detalle del reporte" actions={<StatusBadge status={incident.status} />} />
      <Card className="space-y-5">
        {incident.photo_url ? (
          <img
            className="max-h-[60vh] w-full rounded-lg border border-slate-200 bg-slate-100 object-contain"
            src={incident.photo_url}
            alt="Foto de evidencia del reporte"
          />
        ) : (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Este reporte no tiene foto.
          </p>
        )}
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Item label="Tipo">{labelOf(INCIDENT_TYPES, incident.type)}</Item>
          <Item label="Severidad">{labelOf(INCIDENT_SEVERITIES, incident.severity)}</Item>
          <Item label="Descripción" wide>
            {incident.description}
          </Item>
          <Item label="Ubicación">
            Lat {incident.lat.toFixed(6)}, Lng {incident.lng.toFixed(6)}
            {incident.accuracy !== null && ` (±${Math.round(incident.accuracy)} m)`}
          </Item>
          <Item label="Fecha">{formatDateTime(incident.created_at)}</Item>
          <Item label="Estatus">{labelOf(INCIDENT_STATUSES, incident.status)}</Item>
        </dl>
        <StaticMap lat={incident.lat} lng={incident.lng} />
      </Card>
      <Card className="space-y-4">
        <SectionTitle>Cambiar estatus</SectionTitle>
        <Field label="Nuevo estatus">
          {(props) => (
            <select
              {...props}
              value={next}
              disabled={saving}
              onChange={(event) => {
                setNext(event.target.value as IncidentStatus);
                setMessage(undefined);
              }}
              className={controlStyles}
            >
              {INCIDENT_STATUSES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          disabled={next === incident.status}
          onClick={() => {
            setMessage(undefined);
            setConfirming(true);
          }}
        >
          Cambiar estatus
        </Button>
        {message && (
          <Alert
            role={message.kind === 'ok' ? 'status' : 'alert'}
            tone={message.kind === 'ok' ? 'success' : 'danger'}
          >
            {message.text}
          </Alert>
        )}
      </Card>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !saving && setConfirming(open)}
        title="Cambiar el estatus"
        confirmLabel="Confirmar"
        busy={saving}
        onConfirm={() => void save()}
      >
        ¿Cambiar el estatus a «{nextLabel}»? Se avisará por notificación a quien hizo el reporte.
      </ConfirmDialog>
    </div>
  );
}

function Item({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{label}</dt>
      <dd className="mt-1 text-slate-900">{children}</dd>
    </div>
  );
}
