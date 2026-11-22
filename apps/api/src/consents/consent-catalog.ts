/**
 * Pure catalog of LUFT consents (habeas data): purpose, scope and what
 * happens when the user revokes each one. Texts are shown as-is in the app.
 */

export const CONSENT_VERSION = '2026-11-22';

export const CONSENT_KINDS = [
  'DATA_PROCESSING',
  'BUREAU_QUERY',
  'SCORE_SHARE_WITH_STARTIF',
  'COMMUNICATIONS',
  'HOUSEHOLD_SHARING',
  'OPEN_FINANCE',
  'TAX_ASSISTANCE',
] as const;
export type ConsentKindCode = (typeof CONSENT_KINDS)[number];

export interface ConsentDefinition {
  title: string;
  purpose: string;
  scope: string[];
  revocable: boolean;
  revokeEffect: string;
}

export const CONSENT_CATALOG: Record<ConsentKindCode, ConsentDefinition> = {
  DATA_PROCESSING: {
    title: 'Tratamiento de datos personales',
    purpose:
      'Crear tu cuenta, prestarte el servicio LUFT y cumplir las obligaciones legales de Tureporte S.A.S. como responsable del tratamiento.',
    scope: [
      'Datos de identificación y contacto',
      'Datos de tu perfil y de uso',
    ],
    revocable: false,
    revokeEffect:
      'Es la autorización básica del servicio: para retirarla debes cerrar tu cuenta desde Perfil → Cuenta. Si tienes registros financieros, la ley exige conservarlos por el tiempo de retención.',
  },
  BUREAU_QUERY: {
    title: 'Consulta en centrales de riesgo',
    purpose:
      'Consultar tu información ante operadores de información financiera para tu diagnóstico y para medir la evolución de tu historial.',
    scope: ['Puntaje e historial crediticio en DataCrédito o TransUnion'],
    revocable: true,
    revokeEffect:
      'No haremos nuevas consultas en centrales de riesgo. Las consultas ya realizadas se conservan como parte de tu historial en LUFT.',
  },
  SCORE_SHARE_WITH_STARTIF: {
    title: 'Compartir tu diagnóstico con StartIF',
    purpose:
      'Compartir con StartIF tu diagnóstico, arquetipo y puntaje únicamente para estudiar y gestionar tu solicitud de crédito.',
    scope: ['Diagnóstico', 'Arquetipo', 'Puntaje'],
    revocable: true,
    revokeEffect:
      'No podrás iniciar nuevas solicitudes de crédito con StartIF hasta que vuelvas a autorizar. Un crédito que ya esté vigente sigue su curso con las autorizaciones que firmaste con StartIF.',
  },
  COMMUNICATIONS: {
    title: 'Comunicaciones',
    purpose:
      'Enviarte comunicaciones transaccionales y educativas por los canales que registraste.',
    scope: ['Correo', 'WhatsApp', 'SMS', 'Notificaciones'],
    revocable: true,
    revokeEffect:
      'Dejaremos de enviarte mensajes educativos y promocionales. Seguirás recibiendo los avisos indispensables de tu cuenta y de tus obligaciones.',
  },
  HOUSEHOLD_SHARING: {
    title: 'Participación en un hogar LUFT',
    purpose:
      'Participar en un hogar LUFT y compartir con sus integrantes únicamente las métricas que tú elijas, además de metas y aportes.',
    scope: [
      'Métricas que autorices una por una',
      'Metas compartidas',
      'Aportes',
    ],
    revocable: true,
    revokeEffect:
      'Dejarás de compartir todas tus métricas con el hogar. Sigues siendo integrante hasta que salgas del hogar, y tu perfil nunca se fusiona con el de otra persona.',
  },
  OPEN_FINANCE: {
    title: 'Conexión Open Finance',
    purpose:
      'Leer temporalmente la información de las cuentas que selecciones para observar ingresos, pagos recurrentes y capacidad. Nunca pedimos tus claves bancarias.',
    scope: [
      'Cuentas seleccionadas',
      'Movimientos',
      'Ingresos y pagos recurrentes',
    ],
    revocable: true,
    revokeEffect:
      'Se cancelan tus conexiones Open Finance y no leeremos más información de tus cuentas.',
  },
  TAX_ASSISTANCE: {
    title: 'Asistencia de formalización tributaria',
    purpose:
      'Tratar tu declaración de renta y sus soportes para orientarte, y permitir que un profesional los revise.',
    scope: [
      'Declaración de renta',
      'Soportes tributarios',
      'Datos de tu perfil financiero',
    ],
    revocable: true,
    revokeEffect:
      'No podrás cargar nuevos documentos tributarios ni enviar tu caso a revisión hasta que vuelvas a autorizar. Lo ya verificado se conserva como evidencia.',
  },
};

export const CONSENT_TEXTS: Record<
  'HOUSEHOLD_SHARING' | 'OPEN_FINANCE' | 'TAX_ASSISTANCE',
  string
> = {
  HOUSEHOLD_SHARING:
    'Acepto de manera previa, expresa e informada participar en este hogar LUFT. Entiendo que mi cuenta, mi expediente, mi perfil, mi puntaje, mis productos y mi matching son míos e independientes, que solo se compartirán con el hogar las métricas que yo autorice una por una, y que puedo cambiar esos permisos o salir del hogar cuando quiera. El responsable del tratamiento es Tureporte S.A.S. (política en https://restaurar.co/privacy).',
  OPEN_FINANCE:
    'Autorizo de manera previa, expresa e informada a LUFT (Tureporte S.A.S.) para acceder, a través de un proveedor de Open Finance regulado y por el tiempo indicado, a la información de las cuentas que yo seleccione, con el fin de observar mis ingresos, pagos recurrentes y capacidad. LUFT nunca me pedirá mis claves bancarias y puedo revocar esta autorización en cualquier momento.',
  TAX_ASSISTANCE:
    'Autorizo de manera previa, expresa e informada a LUFT (Tureporte S.A.S.) para tratar mi declaración de renta y los soportes que yo cargue, con el fin de orientarme en mi formalización tributaria y de que un profesional los revise. Entiendo que el diagnóstico es una orientación y no una determinación definitiva.',
};

export interface ConsentRecord {
  id: string;
  kind: string;
  version: string;
  acceptedAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
  scope: unknown;
}

export type ConsentStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUPERSEDED';

/** The latest non-revoked acceptance of each kind is the one in force. */
export function consentView(records: ConsentRecord[], now: Date = new Date()) {
  const newest = new Map<string, string>();
  for (const record of [...records].sort(
    (a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime(),
  ))
    if (!record.revokedAt && !newest.has(record.kind))
      newest.set(record.kind, record.id);
  return records
    .map((record) => {
      const definition = CONSENT_CATALOG[record.kind as ConsentKindCode];
      const status: ConsentStatus = record.revokedAt
        ? 'REVOKED'
        : record.expiresAt && record.expiresAt.getTime() < now.getTime()
          ? 'EXPIRED'
          : newest.get(record.kind) === record.id
            ? 'ACTIVE'
            : 'SUPERSEDED';
      const scope =
        Array.isArray(record.scope) &&
        record.scope.every((entry) => typeof entry === 'string')
          ? (record.scope as string[])
          : (definition?.scope ?? []);
      return {
        id: record.id,
        domain: 'LUFT' as const,
        kind: record.kind,
        title: definition?.title ?? record.kind,
        purpose: definition?.purpose ?? '',
        scope,
        version: record.version,
        acceptedAt: record.acceptedAt,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
        status,
        revocable: status === 'ACTIVE' && (definition?.revocable ?? false),
        revokeEffect: definition?.revokeEffect ?? '',
      };
    })
    .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
}

export function isActive(
  record: Pick<ConsentRecord, 'revokedAt' | 'expiresAt'>,
  now: Date = new Date(),
) {
  return (
    !record.revokedAt &&
    (!record.expiresAt || record.expiresAt.getTime() >= now.getTime())
  );
}
