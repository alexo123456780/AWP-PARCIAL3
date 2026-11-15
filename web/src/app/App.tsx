import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Skeleton } from './Skeleton';
import { UpdateNotice } from './UpdateNotice';

// Cada página es un chunk aparte: el JS inicial no carga el código de las rutas que no se visitan (PRD §4).
const NuevoReporte = lazy(() => import('../pages/NuevoReporte'));
const MisReportes = lazy(() => import('../pages/MisReportes'));
const Detalle = lazy(() => import('../pages/Detalle'));
const Panel = lazy(() => import('../pages/Panel'));

export function App() {
  return (
    <>
      <UpdateNotice />
      <Suspense fallback={<Skeleton />}>
        <Routes>
          <Route path="/" element={<NuevoReporte />} />
          <Route path="/reportes" element={<MisReportes />} />
          <Route path="/reportes/:id" element={<Detalle />} />
          <Route path="/panel" element={<Panel />} />
        </Routes>
      </Suspense>
    </>
  );
}
