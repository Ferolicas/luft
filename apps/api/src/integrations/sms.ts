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

export const LABSMOBILE_BALANCE_URL = 'https://api.labsmobile.com/json/balance';
export const LABSMOBILE_PRICES_URL = 'https://api.labsmobile.com/json/prices';

export interface SmsBalance {
  credits: number;
  /** Créditos que descuenta un SMS a Colombia. */
  perMessage: number;
  /** SMS completos que alcanza a pagar el saldo. */
  remaining: number;
}

/** Devuelve `null` si el proveedor no dio cifras utilizables. */
export function smsBalance(
  credits: unknown,
  perMessage: unknown,
): SmsBalance | null {
  const balance = Number(credits);
  const price = Number(perMessage);
  if (!Number.isFinite(balance) || !Number.isFinite(price) || price <= 0)
    return null;
  return {
    credits: balance,
    perMessage: price,
    remaining: Math.max(0, Math.floor(balance / price + 1e-9)),
  };
}

export function lowBalanceEmail(
  balance: SmsBalance,
  threshold: number,
): { subject: string; html: string } {
  const remaining = balance.remaining;
  return {
    subject:
      remaining === 0
        ? 'LUFT se quedó sin saldo de SMS'
        : `A LUFT le quedan ${remaining} SMS de saldo`,
    html: [
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1c1c1c">',
      '<h1 style="font-size:20px;margin:0 0 12px">Saldo de SMS bajo</h1>',
      `<p style="margin:0 0 12px">El saldo de LabsMobile alcanza para <strong>${remaining} SMS</strong> a Colombia (${balance.credits.toFixed(3)} créditos). El aviso salta cuando quedan ${threshold} o menos.</p>`,
      '<p style="margin:0 0 12px">Cada registro nuevo en LUFT gasta un SMS para validar el celular. Sin saldo, nadie puede terminar de crear su cuenta.</p>',
      '<p style="margin:0 0 12px">Recarga créditos en <a href="https://www.labsmobile.com">labsmobile.com</a>. Este aviso se repite una vez al día mientras el saldo siga bajo.</p>',
      '</div>',
    ].join(''),
  };
}
