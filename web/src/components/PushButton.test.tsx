import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePush, hasPushSubscription, isPushSupported } from '../modules/push';
import { PushButton } from './PushButton';

vi.mock('../modules/push');

const requestPermission = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPushSupported).mockReturnValue(true);
  vi.mocked(hasPushSubscription).mockResolvedValue(false);
  vi.mocked(enablePush).mockReset();
  requestPermission.mockReset();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PushButton', () => {
  it('nunca pide el permiso ni suscribe al cargar: solo ofrece el botón', async () => {
    render(<PushButton />);

    expect(screen.getByRole('button', { name: 'Activar avisos' })).toHaveProperty(
      'disabled',
      false,
    );
    await waitFor(() => expect(hasPushSubscription).toHaveBeenCalled());
    expect(enablePush).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('sin soporte de push oculta el botón y explica que no habrá avisos', () => {
    vi.mocked(isPushSupported).mockReturnValue(false);
    render(<PushButton />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/no admite avisos/)).toBeTruthy();
    expect(screen.getByText(/no recibirás notificaciones/)).toBeTruthy();
    expect(screen.getByText(/iOS 16.4/)).toBeTruthy();
    expect(hasPushSubscription).not.toHaveBeenCalled();
  });

  it('al tocar el botón activa los avisos y lo confirma', async () => {
    let finish!: (result: 'enabled') => void;
    vi.mocked(enablePush).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<PushButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));
    expect(enablePush).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Activando avisos…' })).toHaveProperty(
      'disabled',
      true,
    );

    finish('enabled');
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('Avisos activados'),
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('si el dispositivo ya estaba suscrito lo muestra como activado, sin pedir nada', async () => {
    vi.mocked(hasPushSubscription).mockResolvedValue(true);
    render(<PushButton />);

    expect(await screen.findByText(/Avisos activados/)).toBeTruthy();
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('si el usuario niega el permiso lo informa y sigue sin botón', async () => {
    vi.mocked(enablePush).mockResolvedValue('denied');
    render(<PushButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));

    expect(await screen.findByText(/bloqueadas/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('si el permiso ya estaba bloqueado al abrir, lo informa sin ofrecer el botón', () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
    render(<PushButton />);

    expect(screen.getByText(/bloqueadas/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('si el servidor no tiene push configurado lo informa', async () => {
    vi.mocked(enablePush).mockResolvedValue('unavailable');
    render(<PushButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));

    expect(await screen.findByText(/no están disponibles por ahora/)).toBeTruthy();
  });

  it('ante un fallo muestra el error y deja reintentar', async () => {
    vi.mocked(enablePush).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<PushButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Activar avisos' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('No se pudieron activar los avisos'),
    );
    expect(screen.getByRole('button', { name: 'Activar avisos' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});
