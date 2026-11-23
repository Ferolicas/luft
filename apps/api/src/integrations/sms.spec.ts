import {
  buildSmsRequest,
  LABSMOBILE_SEND_URL,
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
