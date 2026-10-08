import { useState, type ChangeEvent } from 'react';

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

interface FilePickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  /** Error que devolvió el servidor para los archivos (por ejemplo, un tipo no válido). */
  serverError?: string;
  buttonLabel?: string;
}

export default function FilePicker({
  files,
  onChange,
  serverError,
  buttonLabel = 'Adjuntar documentos',
}: FilePickerProps) {
  const [localError, setLocalError] = useState<string | null>(null);

  function add(e: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite volver a elegir el mismo archivo

    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      return setLocalError(
        `"${tooBig.name}" pesa más de 10 MB. Prueba con una foto más liviana o un PDF más pequeño.`,
      );
    }
    if (files.length + incoming.length > MAX_FILES) {
      return setLocalError(`Puedes adjuntar hasta ${MAX_FILES} archivos por envío.`);
    }

    setLocalError(null);
    onChange([...files, ...incoming]);
  }

  const error = localError ?? serverError;

  return (
    <div>
      <p className="font-medium text-stone-900">Documentos</p>
      <p className="mt-1 text-sm text-stone-600">
        PDF, JPG, PNG o WebP. Hasta {MAX_FILES} archivos de 10 MB. Puedes tomar una foto o elegirla de tu galería.
      </p>

      <label className="mt-3 inline-block cursor-pointer rounded-md border border-teal-800 px-4 py-3 text-teal-900 focus-within:ring-2 focus-within:ring-teal-700">
        {buttonLabel}
        <input
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={add}
          className="sr-only"
        />
      </label>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {files.map((f, i) => (
          <li
            key={`${f.name}-${f.size}-${i}`}
            className="flex items-center justify-between rounded-md bg-stone-100 px-3 py-2 text-sm"
          >
            <span className="truncate pr-3">{f.name}</span>
            <button
              type="button"
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="text-teal-800 underline"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}