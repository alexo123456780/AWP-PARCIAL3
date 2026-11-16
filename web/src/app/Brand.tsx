import { ShieldCheck } from 'lucide-react';

/** Marca de CivicGuard (escudo + nombre): la misma que dibuja el cascarón estático de index.html. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-white/15">
        <ShieldCheck aria-hidden="true" className="size-5" />
      </span>
      <h1 className="text-lg font-bold tracking-tight">CivicGuard</h1>
    </div>
  );
}
