import type { SyncState } from '../modules/reports';

// El estado se dice con texto Y con un ícono, además del color (RF-8): quien no distingue colores lo lee igual.
// El ícono es decorativo (`aria-hidden`): el texto ya lo dice para lectores de pantalla.
const BADGES: Record<SyncState, { icon: string; label: string }> = {
  pending: { icon: '⏳', label: 'Pendiente' },
  sent: { icon: '✓', label: 'Enviado' },
  error: { icon: '⚠', label: 'Con error' },
};

export function SyncBadge({ state }: { state: SyncState }) {
  const { icon, label } = BADGES[state];
  return (
    <span className={`sync-badge sync-badge-${state}`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}
