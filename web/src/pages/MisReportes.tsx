import { ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PushButton } from '../components/PushButton';
import { SyncBadge } from '../components/SyncBadge';
import { useOutbox } from '../hooks/useOutbox';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  labelOf,
} from '../modules/incident-options';
import { formatDateTime } from '../modules/reports';
import { Alert, Badge, buttonStyles, EmptyState, Loading, PageHeader } from '../ui';

export default function MisReportes() {
  const reports = useOutbox();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mis reportes"
        description="Los que hiciste desde este dispositivo y cómo van."
      />
      <PushButton />
      {reports.status === 'loading' && <Loading>Cargando tus reportes…</Loading>}
      {reports.status === 'error' && (
        <Alert role="alert" tone="danger">
          No se pudieron leer los reportes de este dispositivo. Cierra la app y vuelve a abrirla.
        </Alert>
      )}
      {reports.status === 'ready' && (
        <>
          {reports.stale && (
            <Alert role="status" tone="warning">
              Sin conexión: se muestran los datos guardados la última vez.
            </Alert>
          )}
          {reports.items.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Aún no tienes reportes"
              action={
                <Link to="/" className={buttonStyles()}>
                  Crea el primero
                </Link>
              }
            >
              Cuando hagas uno aparecerá aquí con su estado de envío.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {reports.items.map((report) => (
                <li key={report.id}>
                  <Link
                    to={`/reportes/${report.id}`}
                    className="block min-h-11 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {labelOf(INCIDENT_TYPES, report.type)} ·{' '}
                        {labelOf(INCIDENT_SEVERITIES, report.severity)}
                      </span>
                      <span className="text-sm text-slate-600">
                        {formatDateTime(report.createdAt)}
                      </span>
                    </span>
                    <span className="line-clamp-2 block text-sm text-slate-700">
                      {report.description}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <SyncBadge state={report.sync} />
                      {report.status && (
                        <Badge tone="brand">
                          Estatus: {labelOf(INCIDENT_STATUSES, report.status)}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
