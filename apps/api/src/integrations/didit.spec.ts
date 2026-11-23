import { createHmac } from 'node:crypto';
import {
  diditCanonicalJson,
  diditDocumentMatches,
  diditOutcome,
  diditReady,
  diditSessionRequest,
  diditSignatureValid,
} from './didit';

const settings = {
  apiKey: 'clave',
  workflowId: '11111111-2222-3333-4444-555555555555',
  webhookSecret: 'secreto',
};
const sign = (data: string) =>
  createHmac('sha256', 'secreto').update(data).digest('hex');

describe('validación de identidad con Didit', () => {
  it('arma la sesión con el flujo configurado y el intento como referencia', () => {
    expect(diditReady(settings)).toBe(true);
    expect(diditReady({ apiKey: 'clave' })).toBe(false);
    const request = diditSessionRequest(settings, {
      vendorData: 'intento-1',
      callback: 'https://luft.com.co/app/credito',
      metadata: { applicationId: 'a1' },
      document: '1234567890',
    });
    expect(request.url).toBe('https://verification.didit.me/v3/session/');
    expect(request.headers['x-api-key']).toBe('clave');
    expect(request.body).toMatchObject({
      workflow_id: settings.workflowId,
      vendor_data: 'intento-1',
      callback: 'https://luft.com.co/app/credito',
      language: 'es',
      expected_details: {
        id_country: 'COL',
        identification_number: '1234567890',
      },
    });
  });

  it('acepta solo webhooks firmados y recientes', () => {
    const body = {
      status: 'Approved',
      session_id: 's1',
      decision: { b: 1, a: [2, { z: 1, y: 2 }] },
    };
    const canonical = diditCanonicalJson(body);
    expect(canonical).toBe(
      '{"decision":{"a":[2,{"y":2,"z":1}],"b":1},"session_id":"s1","status":"Approved"}',
    );
    const base = {
      secret: 'secreto',
      body,
      nowSeconds: 1_000_000,
      timestamp: '1000010',
    };
    expect(diditSignatureValid({ ...base, signatureV2: sign(canonical) })).toBe(
      true,
    );
    const raw = Buffer.from(JSON.stringify(body));
    expect(
      diditSignatureValid({
        ...base,
        signature: sign(raw.toString()),
        rawBody: raw,
      }),
    ).toBe(true);
    expect(diditSignatureValid({ ...base, signatureV2: sign('otro') })).toBe(
      false,
    );
    expect(
      diditSignatureValid({
        ...base,
        signatureV2: sign(canonical),
        timestamp: '1000400',
      }),
    ).toBe(false);
    expect(
      diditSignatureValid({
        ...base,
        signatureV2: sign(canonical),
        timestamp: undefined,
      }),
    ).toBe(false);
    expect(
      diditSignatureValid({
        ...base,
        secret: undefined,
        signatureV2: sign(canonical),
      }),
    ).toBe(false);
  });

  it('traduce el estado de Didit', () => {
    expect(diditOutcome('Approved')).toBe('COMPLETED');
    expect(diditOutcome('APPROVED')).toBe('COMPLETED');
    for (const status of ['Declined', 'Abandoned', 'Expired', 'Kyc Expired'])
      expect(diditOutcome(status)).toBe('FAILED');
    for (const status of [
      'Not Started',
      'In Progress',
      'In Review',
      'Resubmitted',
      'Awaiting User',
      undefined,
    ])
      expect(diditOutcome(status)).toBe('PROCESSING');
  });

  it('exige que la cédula validada sea la registrada', () => {
    const decision = {
      id_verifications: [
        { status: 'Approved', document_number: '1.234.567.890' },
      ],
    };
    expect(diditDocumentMatches(decision, '1234567890')).toBe(true);
    expect(diditDocumentMatches(decision, '1234567891')).toBe(false);
    expect(
      diditDocumentMatches(
        { id_verifications: [{ personal_number: '1234567890' }] },
        '1234567890',
      ),
    ).toBe(true);
    expect(diditDocumentMatches({ id_verifications: [] }, '1234567890')).toBe(
      false,
    );
    expect(diditDocumentMatches(null, '1234567890')).toBe(false);
    expect(diditDocumentMatches(decision, '')).toBe(false);
  });
});
