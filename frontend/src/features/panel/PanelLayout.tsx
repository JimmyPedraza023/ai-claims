import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken, getUser } from './session';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-teal-800 text-white' : 'text-stone-700 hover:bg-stone-200'
  }`;

export default function PanelLayout() {
  const navigate = useNavigate();
  const user = getUser();

  function logout() {
    clearToken();
    navigate('/panel/login', { replace: true });
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-stone-300 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Panel" className="flex items-center gap-1">
            <span className="mr-3 font-semibold text-stone-900">Panel AIX</span>
            <NavLink to="/panel" end className={linkClass}>
              Casos
            </NavLink>
            <NavLink to="/panel/metricas" className={linkClass}>
              Métricas
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-stone-600 sm:inline">{user?.fullName}</span>
            <button onClick={logout} className="text-sm text-teal-800 underline underline-offset-4">
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}