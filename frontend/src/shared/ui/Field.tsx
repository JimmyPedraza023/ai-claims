import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export default function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-900">{label}</span>
      {hint && <span className="block text-sm text-stone-600">{hint}</span>}
      <span className="mt-1 block">{children}</span>
      {error && (
        <span role="alert" className="mt-1 block text-sm text-red-800">
          {error}
        </span>
      )}
    </label>
  );
}