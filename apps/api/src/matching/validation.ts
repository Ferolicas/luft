import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

/** Shared request helpers for the matching and analytics modules. */

export const PAGE_SIZE = 25;

/** Parses with zod and answers 400 with the field problems instead of a 500. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw new BadRequestException({
    code: 'validation_error',
    message: 'Revisa los datos enviados.',
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidSchema = z.string().regex(UUID, 'Identificador inválido.');

/** A malformed id can never match a row: answer 404 before querying. */
export function parseId(value: string, message = 'Registro no encontrado.') {
  if (!UUID.test(value)) throw new NotFoundException(message);
  return value.toLowerCase();
}

export function pageNumber(value?: string | number): number {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
}

export function paginated<T>(items: T[], total: number, page: number) {
  return {
    items,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  };
}

export const copSchema = z.coerce.number().int().min(0).max(100_000_000_000);

/** Optional query value: an empty string means "not sent". */
export function optionalEnum<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  if (!value) return undefined;
  if (!values.includes(value as T))
    throw new BadRequestException({
      code: 'validation_error',
      message: `Valor no admitido: ${value}.`,
    });
  return value as T;
}

/** True only for a calendar day that exists, written as YYYY-MM-DD. */
export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

export const isoDay = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;

export const toNumber = (value: bigint | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

export const toRate = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined ? null : Number(value.toString());

/** Prisma unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}
