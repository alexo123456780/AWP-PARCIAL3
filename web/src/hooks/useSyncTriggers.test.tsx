import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncTriggers } from './useSyncTriggers';

const { requestSync } = vi.hoisted(() => ({ requestSync: vi.fn() }));
vi.mock('../modules/sync', () => ({ requestSync }));

function Probe() {
  useSyncTriggers();
  return null;
}

const setVisibility = (state: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const fire = (target: Window | Document, type: string) => target.dispatchEvent(new Event(type));

beforeEach(() => {
  requestSync.mockResolvedValue(undefined);
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useSyncTriggers', () => {
  it('pide el envío al abrir la app', () => {
    render(<Probe />);

    expect(requestSync).toHaveBeenCalledOnce();
  });

  it('lo pide de nuevo cuando vuelve la red', () => {
    render(<Probe />);
    requestSync.mockClear();

    fire(window, 'online');

    expect(requestSync).toHaveBeenCalledOnce();
  });

  it('lo pide cuando la pestaña vuelve a primer plano, pero no cuando pasa a segundo plano', () => {
    render(<Probe />);
    requestSync.mockClear();

    setVisibility('hidden');
    fire(document, 'visibilitychange');
    expect(requestSync).not.toHaveBeenCalled();

    setVisibility('visible');
    fire(document, 'visibilitychange');
    expect(requestSync).toHaveBeenCalledOnce();
  });

  it('al desmontar deja de escuchar', () => {
    const { unmount } = render(<Probe />);
    unmount();
    requestSync.mockClear();

    fire(window, 'online');
    fire(document, 'visibilitychange');

    expect(requestSync).not.toHaveBeenCalled();
  });

  it('un fallo al pedir el envío no revienta la app ni queda como promesa sin atender', async () => {
    requestSync.mockRejectedValue(new Error('sin Service Worker'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    render(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
