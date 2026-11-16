import { type FormEvent, useState } from 'react';
import { describeFailure, login, type Role } from '../modules/admin';
import { Alert, Button, controlStyles, Field } from '../ui';

export interface Login {
  token: string;
  role: Role;
  email: string;
}

// Inicio de sesión de cualquier cuenta (coordinador u operador). El JWT sube a `onLogin` y solo vive en memoria
// (RF-5): nunca se escribe en el navegador.
export function LoginForm({ onLogin }: { onLogin: (login: Login) => void | Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setWorking(true);
    try {
      const address = email.trim();
      void onLogin({ ...(await login(address, password)), email: address });
    } catch (failure) {
      setError(describeFailure(failure));
      setPassword('');
      setWorking(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Correo">
        {(props) => (
          <input
            {...props}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={controlStyles}
          />
        )}
      </Field>
      <Field label="Contraseña">
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            required
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={controlStyles}
          />
        )}
      </Field>
      {error && (
        <Alert role="alert" tone="danger">
          {error}
        </Alert>
      )}
      <Button type="submit" size="lg" block disabled={working}>
        {working ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
