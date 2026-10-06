import type { LlmErrorKind } from './llm-provider';

export type AiRunStatus = 'ok' | 'salida_invalida' | 'error' | 'timeout';

export function aiRunStatusFor(kind: LlmErrorKind | 'inesperado'): AiRunStatus {
  if (kind === 'timeout') return 'timeout';
  if (kind === 'invalid_output') return 'salida_invalida';
  return 'error';
}