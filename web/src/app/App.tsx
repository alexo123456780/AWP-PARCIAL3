import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSyncTriggers } from '../hooks/useSyncTriggers';
import { AppShell } from './AppShell';
import { RequireProfile } from './guards';
import { PageSkeleton } from './Skeleton';
import { UpdateNotice } from './UpdateNotice';

// Cada página es un chunk aparte: el JS inicial no carga el código de las rutas que no se visitan (PRD §4).
const Acceso = lazy(() => import('../pages/Acceso'));
const NuevoReporte = lazy(() => import('../pages/NuevoReporte'));
const MisReportes = lazy(() => import('../pages/MisReportes'));
const Detalle = lazy(() => import('../pages/Detalle'));
const Panel = lazy(() => import('../pages/Panel'));

/**
 * Rutas por perfil. `/acceso` es la única pública; el operador solo tiene `/`, `/reportes` y `/reportes/:id`, y el
 * coordinador solo `/panel`: quien no ha entrado no ve ninguna otra, y cualquier ruta desconocida lleva al acceso.
 */
export function App() {
  useSyncTriggers();
  return (
    <>
      <UpdateNotice />
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/acceso" element={<Acceso />} />
          <Route element={<RequireProfile profile="operador" />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<NuevoReporte />} />
              <Route path="/reportes" element={<MisReportes />} />
              <Route path="/reportes/:id" element={<Detalle />} />
            </Route>
          </Route>
          <Route element={<RequireProfile profile="coordinador" />}>
            <Route element={<AppShell wide />}>
              <Route path="/panel" element={<Panel />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/acceso" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
