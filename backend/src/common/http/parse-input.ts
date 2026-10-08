import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Valida con zod y, si falla, responde 400 con errors: [{ field, message }]. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException({
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}