import { type ChangeEvent, type FormEvent, useState } from 'react';
import { ManualLocationForm } from '../components/ManualLocationForm';
import { PhotoCapture } from '../components/PhotoCapture';
import {
  getDeviceId,
  type IncidentSeverity,
  type IncidentType,
  openCivicGuardDB,
  saveReport,
} from '../db/idb';
import { useGeolocation } from '../hooks/useGeolocation';
import { compressImage } from '../modules/image';
import { requestSync } from '../modules/sync';
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, MAX_DESCRIPTION } from '../modules/incident-options';

type Field = 'type' | 'severity' | 'description' | 'location' | 'photo';
type Errors = Partial<Record<Field, string>>;

// Los tres campos que viven dentro del <form>; el primero con error recibe el foco.
const FORM_FIELDS = ['type', 'severity', 'description'] as const;

// El formulario se vuelve a montar (nueva `key`) tras guardar: así se limpian a la vez los campos, la ubicación,
// la foto y la cámara, sin tener que reiniciar cada pieza por separado.
export default function NuevoReporte() {
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <h2>Nuevo reporte</h2>
      <p role="status">
        {saved && 'Reporte guardado en tu dispositivo. Se enviará solo cuando haya conexión.'}
      </p>
      <ReportForm
        key={round}
        onSaved={() => {
          setSaved(true);
          setRound((current) => current + 1);
        }}
        onEdit={() => setSaved(false)}
      />
    </>
  );
}

function ReportForm({ onSaved, onEdit }: { onSaved: () => void; onEdit: () => void }) {
  const geo = useGeolocation();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const edit =
    (set: (value: string) => void) =>
    (event: ChangeEvent<HTMLSelectElement | HTMLTextAreaElement>) => {
      set(event.target.value);
      onEdit();
    };

  const validate = (): Errors => {
    const found: Errors = {};
    if (!type) found.type = 'Elige el tipo de incidencia.';
    if (!severity) found.severity = 'Elige la severidad.';
    const length = description.trim().length;
    if (length === 0) found.description = 'Describe la incidencia.';
    else if (length > MAX_DESCRIPTION) {
      found.description = `La descripción admite hasta ${MAX_DESCRIPTION} caracteres y tiene ${length}.`;
    }
    if (geo.status !== 'success') {
      found.location = 'Falta la ubicación: usa tu ubicación o escribe las coordenadas.';
    }
    if (!photo) found.photo = 'Agrega una foto de evidencia.';
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validate();
    setErrors(found);
    setSaveError(undefined);
    if (Object.keys(found).length > 0 || geo.status !== 'success' || !photo) {
      const first = FORM_FIELDS.find((name) => found[name]);
      if (first) (form.elements.namedItem(first) as HTMLElement).focus();
      return;
    }

    // La hora de captura es la del guardado, no la de la compresión ni la del envío.
    const createdAt = new Date().toISOString();
    setSaving(true);
    let compressed: Blob;
    try {
      compressed = await compressImage(photo);
    } catch {
      setSaveError('No se pudo procesar la foto. Toma otra foto e inténtalo de nuevo.');
      setSaving(false);
      return;
    }
    try {
      const db = await openCivicGuardDB();
      try {
        // La identidad del dispositivo debe existir antes del envío: el SW la lee, pero no la crea.
        await getDeviceId(db);
        await saveReport(db, {
          id: crypto.randomUUID(),
          type: type as IncidentType,
          severity: severity as IncidentSeverity,
          description: description.trim(),
          lat: geo.position.lat,
          lng: geo.position.lng,
          accuracy: geo.position.accuracy,
          photo: compressed,
          createdAt,
        });
      } finally {
        db.close();
      }
    } catch {
      setSaveError(
        'No se pudo guardar el reporte en este dispositivo (¿poco espacio o navegación privada?). Libera espacio e inténtalo de nuevo.',
      );
      setSaving(false);
      return;
    }
    // Sin esperar: guardar ya terminó y el envío puede tardar o no ocurrir (sin red) sin afectar la confirmación.
    void requestSync().catch(() => undefined);
    onSaved();
  };

  return (
    <>
      <form id="reporte" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="reporte-tipo">Tipo de incidencia</label>
          <select
            id="reporte-tipo"
            name="type"
            value={type}
            onChange={edit(setType)}
            aria-invalid={errors.type ? true : undefined}
            aria-describedby={errors.type ? 'reporte-tipo-error' : undefined}
          >
            <option value="">Elige un tipo</option>
            {INCIDENT_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.type && (
            <p id="reporte-tipo-error" className="field-error">
              {errors.type}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="reporte-severidad">Severidad</label>
          <select
            id="reporte-severidad"
            name="severity"
            value={severity}
            onChange={edit(setSeverity)}
            aria-invalid={errors.severity ? true : undefined}
            aria-describedby={errors.severity ? 'reporte-severidad-error' : undefined}
          >
            <option value="">Elige la severidad</option>
            {INCIDENT_SEVERITIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.severity && (
            <p id="reporte-severidad-error" className="field-error">
              {errors.severity}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="reporte-descripcion">Descripción</label>
          <textarea
            id="reporte-descripcion"
            name="description"
            value={description}
            onChange={edit(setDescription)}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={
              errors.description
                ? 'reporte-descripcion-ayuda reporte-descripcion-error'
                : 'reporte-descripcion-ayuda'
            }
          />
          <p id="reporte-descripcion-ayuda" className="field-hint">
            {description.length} de {MAX_DESCRIPTION} caracteres
          </p>
          {errors.description && (
            <p id="reporte-descripcion-error" className="field-error">
              {errors.description}
            </p>
          )}
        </div>
      </form>
      {/* ManualLocationForm es otro <form>: no puede anidarse, por eso la ubicación y la foto van fuera del de arriba. */}
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
        {errors.location && geo.status !== 'success' && (
          <p role="alert" className="field-error">
            {errors.location}
          </p>
        )}
      </section>
      <section aria-labelledby="foto-titulo">
        <h3 id="foto-titulo">Foto de evidencia</h3>
        <PhotoCapture
          photo={photo}
          onChange={(next) => {
            setPhoto(next);
            onEdit();
          }}
        />
        {errors.photo && !photo && (
          <p role="alert" className="field-error">
            {errors.photo}
          </p>
        )}
      </section>
      <div className="report-actions">
        {saveError && (
          <p role="alert" className="field-error">
            {saveError}
          </p>
        )}
        <button type="submit" form="reporte" className="button" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar reporte'}
        </button>
      </div>
    </>
  );
}
