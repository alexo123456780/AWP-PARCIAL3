import { Link } from 'react-router-dom';
import { PushButton } from '../components/PushButton';
import { SyncBadge } from '../components/SyncBadge';
import { useOutbox } from '../hooks/useOutbox';
import { INCIDENT_SEVERITIES, INCIDENT_TYPES, labelOf } from '../modules/incident-options';
import { formatDateTime } from '../modules/reports';

export default function MisReportes() {
  const reports = useOutbox();

  return (
    <>
      <h2>Mis reportes</h2>
      <PushButton />
      {reports.status === 'loading' && <p role="status">Cargando tus reportes…</p>}
      {reports.status === 'error' && (
        <p role="alert" className="field-error">
          No se pudieron leer los reportes de este dispositivo. Cierra la app y vuelve a abrirla.
        </p>
      )}
      {reports.status === 'ready' && (
        <>
          {reports.stale && (
            <p role="status">Sin conexión: se muestran los datos guardados la última vez.</p>
          )}
          {reports.items.length === 0 ? (
            <p>
              Aún no tienes reportes. <Link to="/">Crea el primero</Link>.
            </p>
          ) : (
            <ul className="report-list">
              {reports.items.map((report) => (
                <li key={report.id}>
                  <Link className="report-card" to={`/reportes/${report.id}`}>
                    <span className="report-card-title">
                      {labelOf(INCIDENT_TYPES, report.type)} ·{' '}
                      {labelOf(INCIDENT_SEVERITIES, report.severity)}
                    </span>
                    <span>{formatDateTime(report.createdAt)}</span>
                    <span className="report-card-description">{report.description}</span>
                    <SyncBadge state={report.sync} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
