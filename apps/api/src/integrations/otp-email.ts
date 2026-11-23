/** Correos con código de un solo uso. El SMS queda solo para el registro. */
export type EmailOtpPurpose =
  'LOGIN' | 'SIGNATURE' | 'PASSWORD_RESET' | 'EMAIL_VERIFICATION';

const COPY: Record<EmailOtpPurpose, { subject: string; intro: string }> = {
  LOGIN: {
    subject: 'es tu código para entrar a LUFT',
    intro: 'Usa este código para terminar de iniciar sesión en LUFT.',
  },
  SIGNATURE: {
    subject: 'es tu código para firmar en LUFT',
    intro: 'Usa este código para firmar tu pagaré en LUFT.',
  },
  PASSWORD_RESET: {
    subject: 'es tu código para cambiar tu contraseña de LUFT',
    intro: 'Usa este código para crear una contraseña nueva en LUFT.',
  },
  EMAIL_VERIFICATION: {
    subject: 'es tu código para activar la verificación en dos pasos',
    intro:
      'Usa este código para activar la verificación en dos pasos de tu cuenta LUFT.',
  },
};

export function otpEmail(
  code: string,
  purpose: EmailOtpPurpose,
): { subject: string; html: string } {
  const copy = COPY[purpose];
  return {
    subject: `${code} ${copy.subject}`,
    html: [
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1c1c1c">',
      '<h1 style="font-size:20px;margin:0 0 12px">Tu código LUFT</h1>',
      `<p style="margin:0 0 16px">${copy.intro}</p>`,
      `<p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:0 0 16px">${code}</p>`,
      '<p style="margin:0 0 8px">Vence en 10 minutos y sirve una sola vez.</p>',
      '<p style="margin:0;color:#666">Si no lo pediste, no lo compartas con nadie y cambia tu contraseña.</p>',
      '</div>',
    ].join(''),
  };
}

/** `ana.perez@correo.co` → `an•••@correo.co`, para decir a dónde fue el código. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}
