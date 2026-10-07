import type { z } from 'zod';
import { LlmError } from './llm-provider.js';

function sliceObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

export function extractJson(raw: string | null | undefined): unknown {
  const text = (raw ?? '').trim();
  if (!text) throw new LlmError('invalid_output', 'El modelo devolvió una respuesta vacía');

  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  for (const candidate of [unfenced, sliceObject(unfenced)]) {
    if (candidate === null) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* probar el siguiente candidato */
    }
  }
  throw new LlmError('invalid_output', 'La respuesta del modelo no es JSON');
}

export function parseModelOutput<S extends z.ZodType>(raw: string | null | undefined, schema: S): z.infer<S> {
  const json = extractJson(raw);
  const result = schema.safeParse(json);
  if (!result.success) {
    // Solo rutas y códigos: nunca los valores, que pueden traer datos del documento.
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.code}`)
      .join('; ');
    throw new LlmError('invalid_output', `La salida del modelo no cumple el esquema (${detail})`);
  }
  return result.data;
}