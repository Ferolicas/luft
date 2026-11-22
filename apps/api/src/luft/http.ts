import { PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../generated/identity/enums';

/** Reads a binary request body with a hard size cap (no multipart parser needed). */
export function readBody(request: Request, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new PayloadTooLargeException('El archivo supera los 10 MB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** File name sent by the client in `X-File-Name` (URI-encoded). */
export function uploadedFileName(request: Request) {
  const fallback = 'documento';
  try {
    return decodeURIComponent(request.get('x-file-name') ?? fallback);
  } catch {
    return fallback;
  }
}

export const STAFF_ROLES = [
  Role.COMMERCIAL,
  Role.LEGAL,
  Role.SUPPORT,
  Role.COLLECTIONS,
  Role.RISK,
  Role.FINANCE,
  Role.SUPERADMIN,
];

export const PAGE_SIZE = 25;

/** Normalizes the `page` query of staff listings. */
export function pageOf(value?: string) {
  const page = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export function paged<T>(items: T[], total: number, page: number) {
  return {
    items,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  };
}

export const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'P2002';
