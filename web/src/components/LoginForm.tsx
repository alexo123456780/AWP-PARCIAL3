import { type FormEvent, useState } from 'react';
import { describeFailure, login } from '../modules/admin';

// Acceso del coordinador. El JWT sube a `onLogin` y solo vive en memoria (RF-5): nunca se escribe en el navegador.
export function LoginForm({
  notice,
  onLogin,
}: {
  notice?: string;
  onLogin: (token: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setWorking(true);
    try {
      onLogin(await login(email.trim(), password));
    } catch (failure) {
      setError(describeFailure(failure));
      setPassword('');
      setWorking(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {notice && !error && <p role="status">{notice}</p>}
      <div className="field">
        <label htmlFor="panel-email">Correo</label>
        <input
          id="panel-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="panel-password">Contraseña</label>
        <input
          id="panel-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={72}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={working}>
        {working ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
