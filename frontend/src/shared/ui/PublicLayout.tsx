import { Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-xl px-4 py-4">
          <p className="text-base font-semibold text-slate-900">
            Global Seguros de Vida
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-xl px-4 py-4 text-xs text-slate-500">
          Tus datos se usan solo para atender tu reclamación.
        </p>
      </footer>
    </div>
  );
}