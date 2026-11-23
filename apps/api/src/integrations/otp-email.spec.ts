import { maskEmail, otpEmail } from './otp-email';

describe('correos con código', () => {
  it('pone el código en el asunto y en el cuerpo según el motivo', () => {
    const login = otpEmail('123456', 'LOGIN');
    expect(login.subject).toBe('123456 es tu código para entrar a LUFT');
    expect(login.html).toContain('>123456<');
    expect(login.html).toContain('Vence en 10 minutos');
    expect(otpEmail('654321', 'SIGNATURE').html).toContain('firmar tu pagaré');
    expect(otpEmail('654321', 'PASSWORD_RESET').subject).toContain(
      'cambiar tu contraseña',
    );
    expect(otpEmail('654321', 'EMAIL_VERIFICATION').subject).toContain(
      'dos pasos',
    );
  });

  it('oculta el correo al decir a dónde se envió', () => {
    expect(maskEmail('ana.perez@correo.co')).toBe('an•••@correo.co');
    expect(maskEmail('a@correo.co')).toBe('a•••@correo.co');
    expect(maskEmail('sin-arroba')).toBe('•••');
  });
});
