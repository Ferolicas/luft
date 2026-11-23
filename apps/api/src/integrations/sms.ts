/**
 * Armado de la petición de SMS para cada proveedor. Sin efectos: el envío lo
 * hace `IntegrationService`, aquí solo se decide qué se manda y cómo se lee
 * la respuesta.
 */
export interface SmsSettings {
  provider?: string;
  baseUrl?: string;
  apiUser?: string;
  apiKey?: string;
  senderId?: string;
}

export interface SmsRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const LABSMOBILE_SEND_URL = 'https://api.labsmobile.com/json/send';

/** Sin tildes: cabe en un solo SMS de 160 caracteres en cualquier operador. */
export function otpMessage(code: string): string {
  return `Tu codigo LUFT es ${code}. Expira en 10 minutos.`;
}

export function isLabsMobile(settings: SmsSettings): boolean {
  return settings.provider?.trim().toLowerCase() === 'labsmobile';
}

export function smsReady(settings: SmsSettings): boolean {
  if (isLabsMobile(settings))
    return Boolean(settings.apiUser && settings.apiKey);
  return Boolean(settings.apiKey && settings.baseUrl);
}

/** Devuelve `null` cuando falta configuración: no se intenta ningún envío. */
export function buildSmsRequest(
  settings: SmsSettings,
  destination: string,
  code: string,
): SmsRequest | null {
  if (!smsReady(settings)) return null;
  const sender = settings.senderId?.trim() || 'LUFT';
  if (isLabsMobile(settings)) {
    const credentials = Buffer.from(
      `${settings.apiUser}:${settings.apiKey}`,
    ).toString('base64');
    return {
      url: settings.baseUrl?.trim() || LABSMOBILE_SEND_URL,
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: {
        message: otpMessage(code),
        tpoa: sender,
        // LabsMobile espera el número internacional solo con dígitos.
        recipient: [{ msisdn: destination.replace(/\D/g, '') }],
      },
    };
  }
  return {
    url: settings.baseUrl as string,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: { to: destination, from: sender, message: otpMessage(code) },
  };
}

/**
 * LabsMobile responde 200 también cuando rechaza el envío; el resultado real
 * va en `code` ("0" es aceptado).
 */
export function smsAccepted(
  settings: SmsSettings,
  httpOk: boolean,
  payload: unknown,
): boolean {
  if (!httpOk) return false;
  if (!isLabsMobile(settings)) return true;
  const code = (payload as { code?: unknown } | null)?.code;
  return String(code) === '0';
}
