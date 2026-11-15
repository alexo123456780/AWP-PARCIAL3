import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotice } from './UpdateNotice';

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) {
    super();
  }
  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}

class FakeContainer extends EventTarget {
  register = vi.fn();
  constructor(
    public controller: object | null,
    registration: FakeRegistration,
  ) {
    super();
    this.register.mockResolvedValue(registration);
  }
}

const reload = vi.fn();

// `controller` es lo que distingue una actualización (la página ya tiene SW) de la primera instalación.
function setup({ controlled = true } = {}) {
  const registration = new FakeRegistration();
  const container = new FakeContainer(controlled ? {} : null, registration);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return { registration, container };
}

beforeEach(() => vi.stubGlobal('location', { reload }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('registro del Service Worker', () => {
  it('sin soporte de Service Worker no muestra nada ni falla', () => {
    const { container } = render(<UpdateNotice />);

    expect(container.firstChild).toBeNull();
  });

  it('registra /sw.js con scope /', () => {
    const { container } = setup();
    render(<UpdateNotice />);

    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('si el registro falla, lo registra en consola y no muestra el aviso', async () => {
    const { container } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    container.register.mockRejectedValue(new Error('inseguro'));
    render(<UpdateNotice />);

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('aviso de nueva versión', () => {
  it('muestra «Nueva versión disponible · Actualizar» si ya había un SW nuevo en espera', async () => {
    const { registration } = setup();
    registration.waiting = new FakeWorker('installed');
    render(<UpdateNotice />);

    expect((await screen.findByRole('status')).textContent).toContain('Nueva versión disponible');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
  });

  it('lo muestra cuando un SW nuevo termina de instalarse mientras la página está abierta', async () => {
    const { registration, container } = setup();
    render(<UpdateNotice />);
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    const worker = new FakeWorker('installing');
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    expect(screen.queryByRole('status')).toBeNull();
    worker.moveTo('installed');

    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('no lo muestra en la primera instalación (la página aún no tiene SW)', async () => {
    const { registration, container } = setup({ controlled: false });
    render(<UpdateNotice />);
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
    await Promise.resolve();

    const worker = new FakeWorker('installing');
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');
    worker.moveTo('activated');

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Actualizar envía {type:"SKIP_WAITING"} al SW en espera y recarga solo cuando ya está activado', async () => {
    const { registration, container } = setup();
    const worker = new FakeWorker('installed');
    registration.waiting = worker;
    render(<UpdateNotice />);

    fireEvent.click(await screen.findByRole('button', { name: 'Actualizar' }));

    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    worker.moveTo('activating');
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    worker.moveTo('activated');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('sin pulsar Actualizar nunca envía SKIP_WAITING ni recarga, aunque el SW cambie de estado', async () => {
    const { registration, container } = setup();
    const worker = new FakeWorker('installed');
    registration.waiting = worker;
    render(<UpdateNotice />);
    await screen.findByRole('status');

    container.dispatchEvent(new Event('controllerchange'));
    worker.moveTo('activated');

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
