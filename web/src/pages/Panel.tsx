import { useCallback, useEffect, useRef, useState } from 'react';
import { LoginForm } from '../components/LoginForm';
import { StaticMap } from '../components/StaticMap';
import type { IncidentStatus } from '../db/idb';
import {
  describeFailure,
  AdminError,
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

// Panel del coordinador (HU-09, RF-9). El JWT vive solo en este estado de React: recargar la página o cerrarla lo
// pierde y obliga a entrar de nuevo, y nunca toca `localStorage` ni `sessionStorage` (RF-5).
export default function Panel() {
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();

  return (
    <>
      <h2>Panel del coordinador</h2>
      {token ? (
        <Reports
          token={token}
          onExpired={() => {
            setToken(null);
            setNotice(describeFailure(new AdminError('unauthorized')));
          }}
          onLogout={() => {
            setToken(null);
            setNotice(undefined);
          }}
        />
      ) : (
        <LoginForm
          notice={notice}
          onLogin={(next) => {
            setNotice(undefined);
            setToken(next);
          }}
        />
      )}
    </>
  );
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: ServerIncident[] };

function Reports({
  token,
  onExpired,
  onLogout,
}: {
  token: string;
  onExpired: () => void;
  onLogout: () => void;
}) {
  const [filter, setFilter] = useState<IncidentStatus | ''>('');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [selected, setSelected] = useState<ServerIncident | null>(null);
  // Solo vale la última petición: cambiar el filtro rápido no deja que una respuesta vieja pise a la nueva.
  const latest = useRef(0);

  // Un 401 devuelve al login; cualquier otro fallo se muestra en el sitio con la opción de reintentar.
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
    <>
      <div className="panel-toolbar">
        <div className="field">
          <label htmlFor="panel-filter">Estatus</label>
          <select
            id="panel-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as IncidentStatus | '')}
          >
            <option value="">Todos</option>
            {INCIDENT_STATUSES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="button" onClick={onLogout}>
          Cerrar sesión
        </button>
      </div>
      {loaded.status === 'loading' && <p role="status">Cargando reportes…</p>}
      {loaded.status === 'error' && (
        <>
          <p role="alert" className="field-error">
            {loaded.message}
          </p>
          <button type="button" className="button" onClick={() => load(filter)}>
            Reintentar
          </button>
        </>
      )}
      {loaded.status === 'ready' &&
        (loaded.items.length === 0 ? (
          <p>
            No hay reportes {filter ? `con estatus «${labelOf(INCIDENT_STATUSES, filter)}»` : ''}.
          </p>
        ) : (
          <ul className="report-list">
            {loaded.items.map((incident) => (
              <li key={incident.id}>
                <button type="button" className="report-card" onClick={() => setSelected(incident)}>
                  <span className="report-card-title">
                    {labelOf(INCIDENT_TYPES, incident.type)} ·{' '}
                    {labelOf(INCIDENT_SEVERITIES, incident.severity)}
                  </span>
                  <span>{formatDateTime(incident.created_at)}</span>
                  <span className="report-card-description">{incident.description}</span>
                  <span>Estatus: {labelOf(INCIDENT_STATUSES, incident.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </>
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
  const confirmRef = useRef<HTMLButtonElement>(null);

  // El foco pasa a «Confirmar» al pedir la confirmación (quien usa teclado o lector de pantalla no la pierde).
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

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
    <>
      <button type="button" className="back-link" onClick={onBack}>
        ← Volver a la lista
      </button>
      <h3>Detalle del reporte</h3>
      {incident.photo_url ? (
        <img
          className="photo-preview"
          src={incident.photo_url}
          alt="Foto de evidencia del reporte"
        />
      ) : (
        <p>Este reporte no tiene foto.</p>
      )}
      <dl className="detail-list">
        <dt>Tipo</dt>
        <dd>{labelOf(INCIDENT_TYPES, incident.type)}</dd>
        <dt>Severidad</dt>
        <dd>{labelOf(INCIDENT_SEVERITIES, incident.severity)}</dd>
        <dt>Descripción</dt>
        <dd>{incident.description}</dd>
        <dt>Ubicación</dt>
        <dd>
          Lat {incident.lat.toFixed(6)}, Lng {incident.lng.toFixed(6)}
          {incident.accuracy !== null && ` (±${Math.round(incident.accuracy)} m)`}
        </dd>
        <dt>Fecha</dt>
        <dd>{formatDateTime(incident.created_at)}</dd>
        <dt>Estatus</dt>
        <dd>{labelOf(INCIDENT_STATUSES, incident.status)}</dd>
      </dl>
      <StaticMap lat={incident.lat} lng={incident.lng} />
      <h4>Cambiar estatus</h4>
      <div className="field">
        <label htmlFor="panel-next-status">Nuevo estatus</label>
        <select
          id="panel-next-status"
          value={next}
          disabled={confirming || saving}
          onChange={(event) => {
            setNext(event.target.value as IncidentStatus);
            setMessage(undefined);
          }}
        >
          {INCIDENT_STATUSES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {confirming ? (
        <div role="group" aria-label="Confirmar el cambio de estatus">
          <p>
            ¿Cambiar el estatus a «{nextLabel}»? Se avisará por notificación a quien hizo el
            reporte.
          </p>
          <div className="photo-actions">
            <button
              ref={confirmRef}
              type="button"
              className="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Confirmar'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setConfirming(false)}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button"
          disabled={next === incident.status}
          onClick={() => {
            setMessage(undefined);
            setConfirming(true);
          }}
        >
          Cambiar estatus
        </button>
      )}
      {message && (
        <p
          role={message.kind === 'ok' ? 'status' : 'alert'}
          className={message.kind === 'error' ? 'field-error' : undefined}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
