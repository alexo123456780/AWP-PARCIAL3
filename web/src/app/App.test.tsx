import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('rutas con carga diferida', () => {
  it.each([
    ['/', 'Nuevo reporte'],
    ['/reportes', 'Mis reportes'],
    ['/reportes/42', 'Detalle del reporte'],
    ['/panel', 'Panel del coordinador'],
  ])('%s descarga su página bajo demanda y la muestra', async (path, title) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    // Con React.lazy el skeleton aparece primero; una importación estática nunca lo mostraría.
    expect(screen.getByRole('status').textContent).toContain('Cargando');
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
  });
});
