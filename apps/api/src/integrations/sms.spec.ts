import {
  buildSmsRequest,
  LABSMOBILE_SEND_URL,
  lowBalanceEmail,
  smsBalance,
  otpMessage,
  smsAccepted,
  smsReady,
} from './sms';

const labs = {
  provider: 'labsmobile',
  apiUser: 'cuenta@ejemplo.co',
  apiKey: 'token-secreto',
};

describe('SMS de verificación', () => {
  it('escribe el código en un texto sin tildes', () => {
    expect(otpMessage('123456')).toBe(
      'Tu codigo LUFT es 123456. Expira en 10 minutos.',
    );
    expect(/^[\x20-\x7e]+$/.test(otpMessage('123456'))).toBe(true);
  });

  it('arma la petición de LabsMobile con usuario y token', () => {
    const request = buildSmsRequest(labs, '+573001234567', '123456');
    expect(request).toEqual({
      url: LABSMOBILE_SEND_URL,
      headers: {
        Authorization: `Basic ${Buffer.from('cuenta@ejemplo.co:token-secreto').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: {
        message: 'Tu codigo LUFT es 123456. Expira en 10 minutos.',
        tpoa: 'LUFT',
        recipient: [{ msisdn: '573001234567' }],
      },
    });
  });

  it('no intenta enviar si falta configuración', () => {
    expect(smsReady({ provider: 'labsmobile', apiKey: 'solo-token' })).toBe(
      false,
    );
    expect(
      buildSmsRequest({ provider: 'labsmobile', apiKey: 'x' }, '+57300', '1'),
    ).toBeNull();
    expect(buildSmsRequest({}, '+573001234567', '123456')).toBeNull();
    expect(smsReady({ apiKey: 'x' })).toBe(false);
  });

  it('conserva el formato genérico para otros proveedores', () => {
    expect(
      buildSmsRequest(
        {
          baseUrl: 'https://sms.ejemplo.co/enviar',
          apiKey: 'k',
          senderId: 'X',
        },
        '+573001234567',
        '654321',
      ),
    ).toEqual({
      url: 'https://sms.ejemplo.co/enviar',
      headers: {
        Authorization: 'Bearer k',
        'Content-Type': 'application/json',
      },
      body: {
        to: '+573001234567',
        from: 'X',
        message: 'Tu codigo LUFT es 654321. Expira en 10 minutos.',
      },
    });
  });

  it('lee el resultado real de LabsMobile', () => {
    expect(smsAccepted(labs, true, { code: '0' })).toBe(true);
    expect(smsAccepted(labs, true, { code: 0 })).toBe(true);
    expect(smsAccepted(labs, true, { code: '35' })).toBe(false);
    expect(smsAccepted(labs, true, null)).toBe(false);
    expect(smsAccepted(labs, false, { code: '0' })).toBe(false);
    expect(smsAccepted({ apiKey: 'k', baseUrl: 'https://x' }, true, {})).toBe(
      true,
    );
  });
});

describe('saldo de SMS', () => {
  it('calcula cuántos SMS alcanza a pagar el saldo', () => {
    expect(smsBalance('9.956954285714286', 0.043)).toEqual({
      credits: 9.956954285714286,
      perMessage: 0.043,
      remaining: 231,
    });
    expect(smsBalance('0.86', 0.043)?.remaining).toBe(20);
    expect(smsBalance('0.04', 0.043)?.remaining).toBe(0);
  });

  it('no inventa un saldo si el proveedor no dio cifras', () => {
    expect(smsBalance(undefined, 0.043)).toBeNull();
    expect(smsBalance('10', 0)).toBeNull();
    expect(smsBalance('abc', 0.043)).toBeNull();
  });

  it('avisa con el número de SMS que quedan', () => {
    const low = lowBalanceEmail(
      { credits: 0.86, perMessage: 0.043, remaining: 20 },
      20,
    );
    expect(low.subject).toBe('A LUFT le quedan 20 SMS de saldo');
    expect(low.html).toContain('<strong>20 SMS</strong>');
    expect(
      lowBalanceEmail({ credits: 0, perMessage: 0.043, remaining: 0 }, 20)
        .subject,
    ).toBe('LUFT se quedó sin saldo de SMS');
  });
});
