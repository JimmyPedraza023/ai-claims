import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ApiError, request } from '@/shared/api/client';
import { useTurnstile } from '@/shared/hooks/useTurnstile';

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const DRAFT_KEY = 'intake-draft';

// Los valores deben coincidir con DOCUMENT_TYPES de backend/src/modules/intake/intake.schema.ts
const DOC_TYPES = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PA', label: 'Pasaporte' },
  { value: 'PEP', label: 'Permiso especial de permanencia (PEP)' },
  { value: 'PPT', label: 'Permiso por protección temporal (PPT)' },
];

const EMPTY = {
  narrative: '',
  beneficiaryDocumentType: 'CC',
  beneficiaryDocumentNumber: '',
  beneficiaryFullName: '',
  beneficiaryEmail: '',
  insuredDocumentNumber: '',
  insuredFullName: '',
  consentAccepted: false,
};
type Form = typeof EMPTY;

function loadDraft(): Form {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    // El consentimiento nunca se restaura: debe darse en cada envío.
    return raw ? { ...EMPTY, ...JSON.parse(raw), consentAccepted: false } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export default function IntakePage() {
  const [form, setForm] = useState<Form>(loadDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // Se genera al abrir el formulario y se reutiliza en cada reintento del mismo envío.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const { containerRef, token, reset, failed, enabled } = useTurnstile(siteKey);

  useEffect(() => {
    const rest = Object.fromEntries(
      Object.entries(form).filter(([key]) => key !== 'consentAccepted'),
    );

    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
  }, [form]);

  const set =
    (name: keyof Form) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm((f) => ({ ...f, [name]: value }));
      setErrors((prev) => ({ ...prev, [name]: '' }));
    };

  function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite volver a elegir el mismo archivo
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setFileError(`"${tooBig.name}" pesa más de 10 MB. Prueba con una foto más liviana o un PDF más pequeño.`);
    if (files.length + incoming.length > MAX_FILES) return setFileError(`Puedes adjuntar hasta ${MAX_FILES} archivos por envío.`);
    setFileError(null);
    setFiles((prev) => [...prev, ...incoming]);
  }

  const canSend = useMemo(
    () => !sending && form.consentAccepted && (!enabled || !!token),
    [sending, form.consentAccepted, enabled, token],
  );

  async function onSubmit() {
    setBanner(null);
    setErrors({});
    setSending(true);

    const body = new FormData();
    body.append('idempotencyKey', idempotencyKey);
    Object.entries(form).forEach(([k, v]) => body.append(k, String(v)));
    files.forEach((f) => body.append('files', f));

    try {
      await request('/intake', {
        method: 'POST',
        body,
        headers: token ? { 'x-turnstile-token': token } : {},
      });
      sessionStorage.removeItem(DRAFT_KEY);
      setDone(true);
    } catch (err) {
        if (err instanceof ApiError) {
          if (err.fieldErrors.length) {
            setErrors(Object.fromEntries(err.fieldErrors.map((x) => [x.field, x.message])));
          }
          setBanner(err.message);
        } else {
          setBanner('Algo salió mal de nuestro lado. Inténtalo de nuevo en unos minutos.');
        }
      } finally {
      reset(); // el token de Turnstile es de un solo uso, haya o no error
      setSending(false);
    }
  }

  function startAnother() {
    setForm(EMPTY);
    setFiles([]);
    setIdempotencyKey(crypto.randomUUID()); // nuevo formulario = nueva llave
    setDone(false);
  }

  if (done) {
    return (
      <section className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold text-stone-900">Recibimos tu reclamación</h1>
        <p className="mt-4 text-stone-700">
          Te enviaremos un correo con un enlace para ver qué documentos hemos recibido y si falta alguno. No necesitas crear una cuenta.
        </p>
        <p className="mt-3 text-stone-700">Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.</p>
        <button onClick={startAnother} className="mt-8 text-teal-800 underline underline-offset-4">
          Radicar otra reclamación
        </button>
      </section>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <h1 className="text-2xl font-semibold text-stone-900">Radicar una reclamación</h1>
      <p className="mt-3 text-stone-700">
        Lamentamos tu pérdida. Cuéntanos lo que ocurrió con tus palabras y adjunta los documentos que tengas a la mano; si falta
        alguno, te diremos cuál y podrás subirlo después.
      </p>

      {banner && (
        <p role="alert" className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {banner}
        </p>
      )}

      <div className="mt-8 space-y-6">
        <Field label="¿Qué ocurrió?" error={errors.narrative}>
          <textarea rows={5} value={form.narrative} onChange={set('narrative')} className={input} />
        </Field>

        <fieldset className="space-y-4">
          <legend className="font-medium text-stone-900">Tus datos</legend>
          <Field label="Nombre completo" error={errors.beneficiaryFullName}>
            <input autoComplete="name" value={form.beneficiaryFullName} onChange={set('beneficiaryFullName')} className={input} />
          </Field>
          <Field label="Tipo de documento" error={errors.beneficiaryDocumentType}>
            <select value={form.beneficiaryDocumentType} onChange={set('beneficiaryDocumentType')} className={input}>
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Número de documento" error={errors.beneficiaryDocumentNumber}>
            <input  inputMode={form.beneficiaryDocumentType === 'PA' ? 'text' : 'numeric'}
            autoComplete="off"
            value={form.beneficiaryDocumentNumber}
            onChange={set('beneficiaryDocumentNumber')}
            className={input}/>
          </Field>
          <Field label="Correo electrónico" hint="Aquí te enviaremos el enlace de seguimiento." error={errors.beneficiaryEmail}>
            <input type="email" autoComplete="email" value={form.beneficiaryEmail} onChange={set('beneficiaryEmail')} className={input} />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-medium text-stone-900">Datos de la persona asegurada</legend>
          <Field label="Nombre completo" error={errors.insuredFullName}>
            <input value={form.insuredFullName} onChange={set('insuredFullName')} className={input} />
          </Field>
          <Field label="Número de documento" error={errors.insuredDocumentNumber}>
            <input autoComplete="off"
              value={form.insuredDocumentNumber}
              onChange={set('insuredDocumentNumber')}
              className={input}
            />
          </Field>
        </fieldset>

        <div>
          <p className="font-medium text-stone-900">Documentos</p>
          <p className="mt-1 text-sm text-stone-600">PDF, JPG, PNG o WebP. Hasta 10 archivos de 10 MB. Puedes tomar una foto o elegirla de tu galería.</p>
          <label className="mt-3 inline-block cursor-pointer rounded-md border border-teal-800 px-4 py-3 text-teal-900 focus-within:ring-2 focus-within:ring-teal-700">
            Adjuntar documentos
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={addFiles} className="sr-only" />
          </label>
          {fileError && <p role="alert" className="mt-2 text-sm text-red-800">{fileError}</p>}
          {errors.files && <p role="alert" className="mt-2 text-sm text-red-800">{errors.files}</p>}
          <ul className="mt-3 space-y-2">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md bg-stone-100 px-3 py-2 text-sm">
                <span className="truncate pr-3">{f.name}</span>
                <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-teal-800 underline">
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>

        <label className="flex items-start gap-3 text-sm text-stone-800">
          <input type="checkbox" checked={form.consentAccepted} onChange={set('consentAccepted')} className="mt-1 h-5 w-5" />
          {/* TODO: texto provisional, pendiente de validación (ASSUMPTIONS #20) */}
          <span>Autorizo el tratamiento de mis datos personales para gestionar esta reclamación.</span>
        </label>
        {errors.consentAccepted && <p role="alert" className="text-sm text-red-800">{errors.consentAccepted}</p>}

        {enabled && <div ref={containerRef} />}
        {failed && <p role="alert" className="text-sm text-red-800">No pudimos cargar la verificación. Recarga la página.</p>}

        <button
          onClick={onSubmit}
          disabled={!canSend}
          className="w-full rounded-md bg-teal-800 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {sending ? 'Enviando…' : 'Enviar reclamación'}
        </button>
      </div>
    </main>
  );
}

const input =
  'w-full rounded-md border border-stone-400 bg-white px-3 py-2.5 text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-700';

function Field(props: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-900">{props.label}</span>
      {props.hint && <span className="block text-sm text-stone-600">{props.hint}</span>}
      <span className="mt-1 block">{props.children}</span>
      {props.error && <span role="alert" className="mt-1 block text-sm text-red-800">{props.error}</span>}
    </label>
  );
}