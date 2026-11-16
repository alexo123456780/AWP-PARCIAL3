import { CircleCheck, Clock, type LucideIcon, TriangleAlert } from 'lucide-react';
import type { SyncState } from '../modules/reports';
import { Badge } from '../ui';

// El estado se dice con texto Y con un ícono, además del color (RF-8): quien no distingue colores lo lee igual.
// El ícono es decorativo (`aria-hidden`): el texto ya lo dice para lectores de pantalla.
const BADGES: Record<
  SyncState,
  { icon: LucideIcon; label: string; tone: 'warning' | 'success' | 'danger' }
> = {
  pending: { icon: Clock, label: 'Pendiente', tone: 'warning' },
  sent: { icon: CircleCheck, label: 'Enviado', tone: 'success' },
  error: { icon: TriangleAlert, label: 'Con error', tone: 'danger' },
};

export function SyncBadge({ state }: { state: SyncState }) {
  const { icon: Icon, label, tone } = BADGES[state];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}
