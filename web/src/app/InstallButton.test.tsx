import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallButton } from './InstallButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Lanza `beforeinstallprompt` como lo hace Chrome: cancelable y con `prompt()`.
function offerInstall(prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

const button = () => screen.queryByRole('button', { name: 'Instalar CivicGuard' });

describe('botón de instalación', () => {
  it('no muestra nada mientras el navegador no ofrezca instalar (iOS, app ya instalada)', () => {
    const { container } = render(<InstallButton />);

    expect(container.firstChild).toBeNull();
  });

  it('al capturar beforeinstallprompt muestra el botón y evita la mini-barra de Chrome', () => {
    render(<InstallButton />);
    const { event } = offerInstall();

    expect(button()).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('al tocarlo abre el prompt nativo una sola vez y el botón desaparece', () => {
    render(<InstallButton />);
    const { prompt } = offerInstall();

    fireEvent.click(button()!);

    expect(prompt).toHaveBeenCalledOnce();
    expect(button()).toBeNull();
  });

  it('si el usuario descarta el prompt y Chrome ofrece instalar de nuevo, el botón vuelve', () => {
    render(<InstallButton />);
    offerInstall();
    fireEvent.click(button()!);

    offerInstall();

    expect(button()).not.toBeNull();
  });

  it('desaparece al instalarse la app por otra vía (appinstalled)', () => {
    render(<InstallButton />);
    offerInstall();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(button()).toBeNull();
  });

  it('si prompt() falla, lo registra en consola y no deja una promesa sin atender', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<InstallButton />);
    offerInstall(vi.fn().mockRejectedValue(new Error('ya usado')));

    fireEvent.click(button()!);

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('al desmontarse deja de escuchar el navegador', () => {
    const { unmount } = render(<InstallButton />);
    unmount();

    const { event } = offerInstall();

    expect(event.defaultPrevented).toBe(false);
  });
});
