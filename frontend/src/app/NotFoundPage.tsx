import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold text-slate-900">No encontramos esta página</h1>
      <p className="mt-2 text-slate-600">
        Puede que el enlace esté incompleto. Si quieres radicar una reclamación, empieza desde el inicio.
      </p>
      <Link to="/" className="mt-4 inline-block font-medium text-blue-700 underline">
        Ir al inicio
      </Link>
    </section>
  );
}