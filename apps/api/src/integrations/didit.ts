/**
 * Validación de identidad con Didit: armado de la sesión, comprobación de la
 * firma del webhook y lectura del resultado. Sin efectos: las llamadas y la
 * base de datos las maneja quien usa estas funciones.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DIDIT_BASE_URL = 'https://verification.didit.me';
/** Tolerancia entre el sello de tiempo del webhook y el reloj del servidor. */
export const DIDIT_TIMESTAMP_TOLERANCE_S = 300;

export interface DiditSettings {
  apiKey?: string;
  workflowId?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export function diditReady(settings: DiditSettings): boolean {
  return Boolean(settings.apiKey && settings.workflowId);
}

/** Sesión de verificación alojada por Didit; `vendorData` identifica el intento. */
export function diditSessionRequest(
  settings: DiditSettings,
  input: {
    vendorData: string;
    callback: string;
    metadata: object;
    /** Cédula registrada: Didit avisa si el documento leído es otro. */
    document: string;
  },
) {
  return {
    url: `${(settings.baseUrl ?? DIDIT_BASE_URL).replace(/\/+$/, '')}/v3/session/`,
    headers: {
      'x-api-key': settings.apiKey as string,
      'Content-Type': 'application/json',
    },
    body: {
      workflow_id: settings.workflowId,
      vendor_data: input.vendorData,
      callback: input.callback,
      metadata: input.metadata,
      language: 'es',
      // Solo documentos de identidad colombianos, y el de esta persona.
      expected_details: {
        id_country: 'COL',
        identification_number: input.document,
      },
    },
  };
}

export function diditDecisionUrl(settings: DiditSettings, sessionId: string) {
  return `${(settings.baseUrl ?? DIDIT_BASE_URL).replace(/\/+$/, '')}/v3/session/${encodeURIComponent(sessionId)}/decision/`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}

/** JSON canónico que firma Didit en `X-Signature-V2`: llaves ordenadas y compacto. */
export function diditCanonicalJson(body: unknown): string {
  return JSON.stringify(sortKeys(body));
}

const same = (expected: string, actual: string) =>
  expected.length === actual.length &&
  timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

/**
 * Comprueba que el webhook venga de Didit y sea reciente. Acepta la firma del
 * JSON canónico (`X-Signature-V2`) o la del cuerpo exacto (`X-Signature`).
 */
export function diditSignatureValid(input: {
  secret: string | undefined;
  signatureV2?: string;
  signature?: string;
  timestamp?: string;
  rawBody?: Buffer;
  body: unknown;
  nowSeconds: number;
}): boolean {
  if (!input.secret) return false;
  const timestamp = Number(input.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(input.nowSeconds - timestamp) > DIDIT_TIMESTAMP_TOLERANCE_S
  )
    return false;
  const sign = (data: string | Buffer) =>
    createHmac('sha256', input.secret as string)
      .update(data)
      .digest('hex');
  if (
    input.signatureV2 &&
    same(sign(diditCanonicalJson(input.body)), input.signatureV2.trim())
  )
    return true;
  return Boolean(
    input.signature &&
    input.rawBody &&
    same(sign(input.rawBody), input.signature.trim()),
  );
}

export type KycOutcome = 'COMPLETED' | 'FAILED' | 'PROCESSING';

/** Estado de Didit → estado del proceso en LUFT. */
export function diditOutcome(status: unknown): KycOutcome {
  // La documentación de Didit muestra el estado con y sin mayúsculas.
  switch (
    String(status ?? '')
      .trim()
      .toLowerCase()
  ) {
    case 'approved':
      return 'COMPLETED';
    case 'declined':
    case 'abandoned':
    case 'expired':
    case 'kyc expired':
      return 'FAILED';
    default:
      // Not Started, In Progress, In Review, Resubmitted, Awaiting User.
      return 'PROCESSING';
  }
}

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/**
 * Números de identidad que Didit leyó del documento. Una cédula puede venir
 * como número de documento o como número personal, según el tipo de documento.
 */
export function diditDocumentNumbers(decision: unknown): string[] {
  const checks = (decision as { id_verifications?: unknown } | null)
    ?.id_verifications;
  if (!Array.isArray(checks)) return [];
  return checks
    .flatMap((check: Record<string, unknown>) => [
      digits(check?.document_number),
      digits(check?.personal_number),
    ])
    .filter(Boolean);
}

/** ¿El documento validado es el mismo con el que la persona se registró? */
export function diditDocumentMatches(
  decision: unknown,
  registeredDocument: string,
): boolean {
  const expected = digits(registeredDocument);
  return Boolean(expected) && diditDocumentNumbers(decision).includes(expected);
}
