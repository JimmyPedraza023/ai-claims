import { Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <p className="text-base font-semibold text-slate-900">Global Seguros de Vida</p>
          <p className="text-sm text-slate-600">Reclamaciones de seguros de vida</p>
        </div>
      </header>

      <section className="mx-auto max-w-xl">
        <Outlet />
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-2xl px-4 py-4 text-xs text-slate-500">
          Tus datos se usan solo para atender tu reclamación.
        </p>
      </footer>
    </div>
  );
}