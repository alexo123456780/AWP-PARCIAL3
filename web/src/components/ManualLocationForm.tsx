import { type FormEvent, useState } from 'react';
import { type Coordinates, parseCoordinate } from '../modules/geo';

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
    <form className="manual-location" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="manual-lat">Latitud</label>
        <input
          id="manual-lat"
          name="lat"
          autoComplete="off"
          aria-invalid={errors.lat ? true : undefined}
          aria-describedby={errors.lat ? 'manual-lat-error' : undefined}
        />
        {errors.lat && (
          <p id="manual-lat-error" className="field-error">
            {errors.lat}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="manual-lng">Longitud</label>
        <input
          id="manual-lng"
          name="lng"
          autoComplete="off"
          aria-invalid={errors.lng ? true : undefined}
          aria-describedby={errors.lng ? 'manual-lng-error' : undefined}
        />
        {errors.lng && (
          <p id="manual-lng-error" className="field-error">
            {errors.lng}
          </p>
        )}
      </div>
      <button type="submit" className="button">
        Usar estas coordenadas
      </button>
    </form>
  );
}
