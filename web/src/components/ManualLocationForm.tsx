import { type FormEvent, useState } from 'react';
import { type Coordinates, parseCoordinate } from '../modules/geo';
import { Button, controlStyles, Field } from '../ui';

const LAT_ERROR = 'La latitud debe estar entre −90 y 90.';
const LNG_ERROR = 'La longitud debe estar entre −180 y 180.';

// Captura manual cuando el GPS falla (HU-11). Campos de texto: el teclado decimal de iOS no trae el signo menos.
export function ManualLocationForm({ onSubmit }: { onSubmit: (position: Coordinates) => void }) {
  const [errors, setErrors] = useState<{ lat?: string; lng?: string }>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lat = parseCoordinate(String(data.get('lat')), 90);
    const lng = parseCoordinate(String(data.get('lng')), 180);
    setErrors({
      lat: lat === null ? LAT_ERROR : undefined,
      lng: lng === null ? LNG_ERROR : undefined,
    });
    if (lat !== null && lng !== null) onSubmit({ lat, lng });
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <Field label="Latitud" error={errors.lat}>
        {(props) => <input {...props} name="lat" autoComplete="off" className={controlStyles} />}
      </Field>
      <Field label="Longitud" error={errors.lng}>
        {(props) => <input {...props} name="lng" autoComplete="off" className={controlStyles} />}
      </Field>
      <Button type="submit" variant="secondary">
        Usar estas coordenadas
      </Button>
    </form>
  );
}
