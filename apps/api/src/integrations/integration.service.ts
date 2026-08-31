import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';

export type IntegrationState = 'ready' | 'configuration_required';

export interface IntegrationResult<T> {
  status: IntegrationState;
  provider: string;
  data?: T;
}

@Injectable()
export class IntegrationService {
  constructor(private readonly config: ConfigService) {}

  status() {
    return {
      mercadoPago: this.enabled('MERCADOPAGO'),
      truora: this.enabled('TRUORA'),
      dataCredito: this.enabled('DATACREDITO'),
      transUnion: this.enabled('TRANSUNION'),
      sms: Boolean(this.config.get('SMS_API_KEY')),
      email: Boolean(this.config.get('RESEND_API_KEY')),
      whatsapp: Boolean(
        this.config.get('EVOLUTION_API_KEY') &&
        this.config.get('EVOLUTION_INSTANCE'),
      ),
      n8n:
        this.config.get('N8N_ENABLED') === 'true' &&
        Boolean(this.config.get('N8N_WEBHOOK_SECRET')),
    };
  }

  private enabled(provider: string) {
    return (
      this.config.get(`${provider}_ENABLED`) === 'true' &&
      Boolean(
        this.config.get(`${provider}_ACCESS_TOKEN`) ??
        this.config.get(`${provider}_API_KEY`) ??
        this.config.get(`${provider}_CLIENT_ID`),
      )
    );
  }

  tradelineReady(provider: 'DATACREDITO' | 'TRANSUNION') {
    return (
      this.enabled(provider) &&
      Boolean(this.config.get(`${provider}_TRADELINE_ENDPOINT`))
    );
  }

  private configurationRequired(provider: string): never {
    throw new ServiceUnavailableException({
      code: 'configuration_required',
      provider,
      message: `Faltan credenciales de ${provider}.`,
    });
  }

  async sendOtp(
    destination: string,
    code: string,
  ): Promise<IntegrationResult<{ messageId?: string }>> {
    const apiKey = this.config.get<string>('SMS_API_KEY');
    const baseUrl = this.config.get<string>('SMS_BASE_URL');
    if (!apiKey || !baseUrl)
      return { status: 'configuration_required', provider: 'SMS' };
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: destination,
        from: this.config.get('SMS_SENDER_ID') ?? 'LUFT',
        message: `Tu código LUFT es ${code}. Expira en 10 minutos.`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'SMS',
      });
    return {
      status: 'ready',
      provider: 'SMS',
      data: (await response.json()) as { messageId?: string },
    };
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<IntegrationResult<{ id?: string }>> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey)
      return { status: 'configuration_required', provider: 'RESEND' };
    const result = await new Resend(apiKey).emails.send({
      from:
        this.config.get<string>('EMAIL_FROM') ??
        'LUFT <hola@luft.restaurar.co>',
      to,
      subject,
      html,
    });
    if (result.error)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'RESEND',
        message: result.error.message,
      });
    return {
      status: 'ready',
      provider: 'RESEND',
      data: { id: result.data?.id },
    };
  }

  async sendWhatsApp(
    phone: string,
    text: string,
  ): Promise<IntegrationResult<{ key?: unknown }>> {
    const apiUrl = this.config.get<string>('EVOLUTION_API_URL');
    const apiKey = this.config.get<string>('EVOLUTION_API_KEY');
    const instance = this.config.get<string>('EVOLUTION_INSTANCE');
    if (!apiUrl || !apiKey || !instance)
      return { status: 'configuration_required', provider: 'EVOLUTION' };
    const response = await fetch(
      new URL(`/message/sendText/${encodeURIComponent(instance)}`, apiUrl),
      {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: phone.replace(/^\+/, ''),
          text,
          delay: 800,
          linkPreview: false,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'EVOLUTION',
        status: response.status,
      });
    return {
      status: 'ready',
      provider: 'EVOLUTION',
      data: (await response.json()) as { key?: unknown },
    };
  }

  async startTruoraValidation(input: {
    userId: string;
    document: string;
    email: string;
  }) {
    if (!this.enabled('TRUORA')) this.configurationRequired('TRUORA');
    const baseUrl = this.config.getOrThrow<string>('TRUORA_BASE_URL');
    const endpoint =
      this.config.get<string>('TRUORA_START_ENDPOINT') ?? '/v1/processes';
    const response = await fetch(new URL(endpoint, baseUrl), {
      method: 'POST',
      headers: {
        'Truora-API-Key': this.config.getOrThrow('TRUORA_API_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        flow_id: this.config.getOrThrow('TRUORA_FLOW_ID'),
        account_id: this.config.get('TRUORA_ACCOUNT_ID'),
        user_authorized: true,
        country: 'CO',
        document_number: input.document,
        email: input.email,
        external_user_id: input.userId,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'TRUORA',
        status: response.status,
      });
    return response.json() as Promise<{
      process_id: string;
      validation_url?: string;
    }>;
  }

  async queryBureau(
    provider: 'DATACREDITO' | 'TRANSUNION',
    payload: Record<string, unknown>,
  ) {
    if (!this.enabled(provider)) this.configurationRequired(provider);
    const baseUrl = this.config.getOrThrow<string>(`${provider}_BASE_URL`);
    const endpoint = this.config.getOrThrow<string>(
      `${provider}_REPORT_ENDPOINT`,
    );
    const tokenResponse = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.getOrThrow(`${provider}_CLIENT_ID`),
        client_secret: this.config.getOrThrow(`${provider}_CLIENT_SECRET`),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok)
      throw new ServiceUnavailableException({
        code: 'provider_auth_error',
        provider,
      });
    const token = (await tokenResponse.json()) as { access_token: string };
    const response = await fetch(new URL(endpoint, baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider,
        status: response.status,
      });
    return response.json() as Promise<Record<string, unknown>>;
  }

  async reportTradeline(
    provider: 'DATACREDITO' | 'TRANSUNION',
    payload: Record<string, unknown>,
  ) {
    if (!this.enabled(provider)) this.configurationRequired(provider);
    const endpoint = this.config.get<string>(`${provider}_TRADELINE_ENDPOINT`);
    if (!endpoint) this.configurationRequired(`${provider}_TRADELINE`);
    const baseUrl = this.config.getOrThrow<string>(`${provider}_BASE_URL`);
    const tokenResponse = await fetch(new URL('/oauth/token', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.getOrThrow(`${provider}_CLIENT_ID`),
        client_secret: this.config.getOrThrow(`${provider}_CLIENT_SECRET`),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok)
      throw new ServiceUnavailableException({
        code: 'provider_auth_error',
        provider,
      });
    const token = (await tokenResponse.json()) as { access_token: string };
    const response = await fetch(new URL(endpoint, baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider,
        status: response.status,
      });
    return result;
  }

  async triggerAutomation(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<IntegrationResult<Record<string, unknown>>> {
    const secret = this.config.get<string>('N8N_WEBHOOK_SECRET');
    const baseUrl = this.config.get<string>('N8N_BASE_URL');
    if (this.config.get('N8N_ENABLED') !== 'true' || !secret || !baseUrl)
      return { status: 'configuration_required', provider: 'N8N' };
    const response = await fetch(
      new URL(`/webhook/${path.replace(/^\//, '')}`, baseUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LUFT-Signature': createHmac('sha256', secret)
            .update(JSON.stringify(payload))
            .digest('hex'),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'N8N',
        status: response.status,
      });
    return {
      status: 'ready',
      provider: 'N8N',
      data: (await response.json()) as Record<string, unknown>,
    };
  }

  async createPseOrder(input: {
    amount: number;
    email: string;
    identification: string;
    entity: string;
    description: string;
    idempotencyKey: string;
  }) {
    if (!this.enabled('MERCADOPAGO')) this.configurationRequired('MERCADOPAGO');
    const response = await fetch(
      new URL(
        '/v1/orders',
        this.config.getOrThrow<string>('MERCADOPAGO_BASE_URL'),
      ),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow('MERCADOPAGO_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          type: 'online',
          external_reference: input.idempotencyKey,
          transactions: {
            payments: [
              {
                amount: input.amount.toFixed(2),
                payment_method: {
                  id: 'pse',
                  type: 'bank_transfer',
                  financial_institution: input.entity,
                },
                payer: {
                  email: input.email,
                  identification: { type: 'CC', number: input.identification },
                  entity_type: 'individual',
                },
                description: input.description,
              },
            ],
          },
          processing_mode: 'automatic',
          total_amount: input.amount.toFixed(2),
        }),
        signal: AbortSignal.timeout(25_000),
      },
    );
    const body = (await response.json()) as Record<string, any>;
    if (!response.ok)
      throw new ServiceUnavailableException({
        code: 'provider_error',
        provider: 'MERCADOPAGO',
        status: response.status,
        details: body.cause ?? body.message,
      });
    return body;
  }

  async getMercadoPagoResource(dataId: string, resourceType?: string) {
    if (!this.enabled('MERCADOPAGO')) this.configurationRequired('MERCADOPAGO');
    const baseUrl = this.config.getOrThrow<string>('MERCADOPAGO_BASE_URL');
    const token = this.config.getOrThrow<string>('MERCADOPAGO_ACCESS_TOKEN');
    const paths = resourceType?.toLowerCase().includes('payment')
      ? [
          `/v1/payments/${encodeURIComponent(dataId)}`,
          `/v1/orders/${encodeURIComponent(dataId)}`,
        ]
      : [
          `/v1/orders/${encodeURIComponent(dataId)}`,
          `/v1/payments/${encodeURIComponent(dataId)}`,
        ];
    for (const path of paths) {
      const response = await fetch(new URL(path, baseUrl), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response.json() as Promise<Record<string, any>>;
      if (response.status !== 404)
        throw new ServiceUnavailableException({
          code: 'provider_error',
          provider: 'MERCADOPAGO',
          status: response.status,
        });
    }
    throw new ServiceUnavailableException({
      code: 'provider_resource_not_found',
      provider: 'MERCADOPAGO',
    });
  }

  validateMercadoPagoWebhook(
    signature: string | undefined,
    requestId: string | undefined,
    dataId: string | undefined,
  ) {
    const secret = this.config.get<string>('MERCADOPAGO_WEBHOOK_SECRET');
    if (!secret || !signature || !requestId || !dataId)
      throw new UnauthorizedException('Firma de webhook ausente');
    const parts = Object.fromEntries(
      signature.split(',').map((item) => item.trim().split('=')),
    );
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
    const expected = createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');
    const actual = String(parts.v1 ?? '');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new UnauthorizedException('Firma de webhook inválida');
  }

  validateTruoraWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ) {
    const secret = this.config.get<string>('TRUORA_WEBHOOK_SECRET');
    if (!secret || !signature || !rawBody)
      throw new UnauthorizedException('Firma de webhook ausente');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const actual = signature.replace(/^sha256=/i, '').trim();
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new UnauthorizedException('Firma de webhook inválida');
  }
}
