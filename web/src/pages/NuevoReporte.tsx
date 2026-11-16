import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Crosshair, MapPin } from 'lucide-react';
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
import { Alert, Button, Card, cn, controlStyles, Field, PageHeader, SectionTitle } from '../ui';

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
    <div className="space-y-4">
      <PageHeader
        title="Nuevo reporte"
        description="Cuéntanos qué pasó, dónde y adjunta una foto. Se guarda en tu dispositivo y se envía solo cuando haya conexión."
      />
      <div role="status">
        {saved && (
          <Alert tone="success">
            Reporte guardado en tu dispositivo. Se enviará solo cuando haya conexión.
          </Alert>
        )}
      </div>
      <ReportForm
        key={round}
        onSaved={() => {
          setSaved(true);
          setRound((current) => current + 1);
        }}
        onEdit={() => setSaved(false)}
      />
    </div>
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
    <div className="space-y-4">
      <Card>
        <form id="reporte" onSubmit={submit} noValidate className="space-y-4">
          <Field label="Tipo de incidencia" error={errors.type}>
            {(props) => (
              <select
                {...props}
                name="type"
                value={type}
                onChange={edit(setType)}
                className={controlStyles}
              >
                <option value="">Elige un tipo</option>
                {INCIDENT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Severidad" error={errors.severity}>
            {(props) => (
              <select
                {...props}
                name="severity"
                value={severity}
                onChange={edit(setSeverity)}
                className={controlStyles}
              >
                <option value="">Elige la severidad</option>
                {INCIDENT_SEVERITIES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Descripción"
            hint={`${description.length} de ${MAX_DESCRIPTION} caracteres`}
            error={errors.description}
          >
            {(props) => (
              <textarea
                {...props}
                name="description"
                value={description}
                onChange={edit(setDescription)}
                className={cn(controlStyles, 'min-h-28 py-2')}
              />
            )}
          </Field>
        </form>
      </Card>
      {/* ManualLocationForm es otro <form>: no puede anidarse, por eso la ubicación y la foto van fuera del de arriba. */}
      <section aria-labelledby="ubicacion-titulo">
        <Card className="space-y-3">
          <SectionTitle id="ubicacion-titulo">Ubicación</SectionTitle>
          {geo.status === 'success' && (
            <p className="flex items-center gap-2 text-sm text-slate-800">
              <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand-600" />
              <span>
                Lat {geo.position.lat.toFixed(6)}, Lng {geo.position.lng.toFixed(6)}
                {geo.position.accuracy !== undefined &&
                  ` (±${Math.round(geo.position.accuracy)} m)`}
              </span>
            </p>
          )}
          <Button
            variant={geo.status === 'success' ? 'secondary' : 'primary'}
            onClick={geo.locate}
            disabled={geo.status === 'loading'}
          >
            <Crosshair aria-hidden="true" className="size-4" />
            {geo.status === 'loading'
              ? 'Obteniendo ubicación…'
              : geo.status === 'success'
                ? 'Actualizar ubicación'
                : 'Usar mi ubicación'}
          </Button>
          {geo.status === 'error' && (
            <>
              <Alert role="alert" tone="warning">
                {geo.error.message}
              </Alert>
              <ManualLocationForm onSubmit={geo.setManual} />
            </>
          )}
          {errors.location && geo.status !== 'success' && (
            <Alert role="alert" tone="danger">
              {errors.location}
            </Alert>
          )}
        </Card>
      </section>
      <section aria-labelledby="foto-titulo">
        <Card className="space-y-3">
          <SectionTitle id="foto-titulo">Foto de evidencia</SectionTitle>
          <PhotoCapture
            photo={photo}
            onChange={(next) => {
              setPhoto(next);
              onEdit();
            }}
          />
          {errors.photo && !photo && (
            <Alert role="alert" tone="danger">
              {errors.photo}
            </Alert>
          )}
        </Card>
      </section>
      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        {saveError && (
          <Alert role="alert" tone="danger">
            {saveError}
          </Alert>
        )}
        <Button type="submit" form="reporte" size="lg" block disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar reporte'}
        </Button>
      </div>
    </div>
  );
}
