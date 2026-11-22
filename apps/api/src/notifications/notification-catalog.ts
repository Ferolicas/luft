/**
 * Pure catalog that turns a whitelisted realtime event into a persistent
 * in-app notification (title, body and link in Spanish). Events outside the
 * whitelist, or statuses that are not worth a notification, return null.
 */

export interface NotificationDraft {
  kind: string;
  title: string;
  body: string;
  href: string | null;
  /** Same event + same subject + same status is stored only once. */
  dedupeKey: string | null;
}

export const NOTIFICATION_EVENTS = [
  'score:status',
  'credit:decision',
  'payment:status',
  'pqr:status',
  'kyc:status',
  'household:invitation',
  'household:contribution',
  'formalization:status',
  'cards:guidance',
  'matching:presentation',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

type Payload = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const ref = (payload: Payload, ...keys: string[]) =>
  keys.map((key) => text(payload[key])).find(Boolean) ?? '';

const draft = (
  kind: string,
  title: string,
  body: string,
  href: string | null,
  dedupe: string | null,
): NotificationDraft => ({
  kind,
  title,
  body,
  href,
  dedupeKey: dedupe ? `${kind}:${dedupe}`.slice(0, 200) : null,
});

const FORMALIZATION_MESSAGES: Record<string, [string, string]> = {
  POSIBLE_OBLIGACION: [
    'Revisa tu diagnóstico tributario',
    'Con lo que declaraste podrías tener que presentar declaración de renta. Cuéntanos si ya la presentaste.',
  ],
  REVISION: [
    'Tu caso tributario está en revisión',
    'Un profesional revisará tu información y te avisaremos el resultado.',
  ],
  DOCUMENTO_CARGADO: [
    'Tu caso tributario tiene observaciones',
    'El profesional dejó observaciones. Revísalas y vuelve a enviar tu caso.',
  ],
  PREPARACION_GUIADA: [
    'Tu caso tributario tiene observaciones',
    'El profesional dejó observaciones. Revísalas y vuelve a enviar tu caso.',
  ],
  APROBADO: [
    'Tu declaración fue aprobada en revisión',
    'El profesional aprobó tu caso. El siguiente paso es la firma y presentación.',
  ],
  PRESENTADO: [
    'Registramos la presentación de tu declaración',
    'Tu declaración quedó registrada como presentada. Falta la verificación final.',
  ],
  VERIFICADO: [
    'Tu declaración quedó verificada',
    'Tu formalización tributaria ya cuenta como evidencia verificada en tu perfil.',
  ],
};

export function notificationFor(
  event: string,
  payload: Payload,
): NotificationDraft | null {
  const status = text(payload.status).toUpperCase();
  switch (event) {
    case 'score:status': {
      const id = ref(payload, 'id');
      if (status === 'COMPLETED')
        return draft(
          'score',
          'Tu puntaje ya está disponible',
          'Terminamos la consulta en la central de riesgo. Mira tu resultado y lo que significa.',
          '/app/puntaje',
          `${id}:${status}`,
        );
      if (status === 'FAILED')
        return draft(
          'score',
          'No pudimos consultar tu puntaje',
          'La central no respondió la consulta. Puedes intentarlo de nuevo más tarde.',
          '/app/puntaje',
          `${id}:${status}`,
        );
      if (status === 'CONFIGURATION_REQUIRED')
        return draft(
          'score',
          'Tu consulta de puntaje quedó pendiente',
          'La consulta en centrales aún no está habilitada. Guardamos tu solicitud y te avisaremos cuando podamos procesarla.',
          '/app/puntaje',
          `${id}:${status}`,
        );
      return null;
    }
    case 'credit:decision': {
      const id = ref(payload, 'applicationId', 'id');
      if (status === 'REJECTED')
        return draft(
          'credit',
          'Tu solicitud de crédito no fue aprobada',
          'Revisa el detalle de la decisión y los pasos que puedes seguir.',
          '/app/credito',
          `${id}:${status}`,
        );
      if (['ACTIVE', 'APPROVED'].includes(status))
        return draft(
          'credit',
          'Tu crédito fue aprobado',
          'Tu crédito constructor quedó activo. Revisa tu plan de pagos.',
          '/app/credito',
          `${id}:${status}`,
        );
      return null;
    }
    case 'payment:status': {
      const id = ref(payload, 'paymentId', 'id');
      if (status === 'APPROVED')
        return draft(
          'payment',
          'Recibimos tu pago',
          'Tu pago fue confirmado y ya se refleja en tu plan.',
          '/app/historial',
          `${id}:${status}`,
        );
      if (['REJECTED', 'CANCELLED', 'EXPIRED'].includes(status))
        return draft(
          'payment',
          'Tu pago no se completó',
          'El pago no fue confirmado. Puedes intentarlo de nuevo.',
          '/app/pagar',
          `${id}:${status}`,
        );
      if (status === 'REFUNDED')
        return draft(
          'payment',
          'Tu pago fue reembolsado',
          'Registramos el reembolso de un pago. Revisa tu historial.',
          '/app/historial',
          `${id}:${status}`,
        );
      return null;
    }
    case 'matching:presentation': {
      const id = ref(payload, 'id');
      const messages: Record<string, [string, string]> = {
        PRESENTADA: [
          'Presentamos tu solicitud a la entidad',
          'La entidad que autorizaste ya recibió tu información. Te avisaremos cuando responda.',
        ],
        APROBADA: [
          'La entidad respondió tu solicitud',
          'Tu solicitud fue aprobada por la entidad. Revisa las condiciones.',
        ],
        RECHAZADA: [
          'La entidad respondió tu solicitud',
          'Esta vez la entidad no aprobó tu solicitud. Revisa el motivo y tus otras oportunidades.',
        ],
        DESISTIDA: [
          'Se cerró una presentación',
          'La presentación a la entidad quedó cerrada sin decisión.',
        ],
      };
      const message = messages[status];
      return message
        ? draft(
            'matching',
            message[0],
            message[1],
            '/app/oportunidades',
            `${id}:${status}`,
          )
        : null;
    }
    case 'pqr:status': {
      const id = ref(payload, 'id');
      const messages: Record<string, [string, string]> = {
        IN_REVIEW: [
          'Estamos revisando tu solicitud',
          'Tu PQR ya está en revisión por nuestro equipo.',
        ],
        WAITING_USER: [
          'Necesitamos información tuya',
          'Tu PQR está a la espera de una respuesta tuya.',
        ],
        RESOLVED: [
          'Respondimos tu solicitud',
          'Tu PQR fue resuelta. Revisa la respuesta.',
        ],
        CLOSED: ['Cerramos tu solicitud', 'Tu PQR fue cerrada.'],
      };
      const message = messages[status];
      return message
        ? draft('pqr', message[0], message[1], '/app/pqr', `${id}:${status}`)
        : null;
    }
    case 'kyc:status': {
      const id = ref(payload, 'id');
      if (status === 'COMPLETED')
        return draft(
          'kyc',
          'Validamos tu identidad',
          'Tu identidad quedó validada. Continúa con la firma de tu crédito.',
          '/app/credito',
          `${id}:${status}`,
        );
      if (status === 'FAILED')
        return draft(
          'kyc',
          'No pudimos validar tu identidad',
          'La validación no se completó. Puedes intentarlo de nuevo.',
          '/app/credito',
          `${id}:${status}`,
        );
      return null;
    }
    case 'household:invitation': {
      if (status !== 'ACCEPTED') return null;
      const name = text(payload.memberName) || 'Tu invitado';
      return draft(
        'household',
        `${name} aceptó tu invitación`,
        text(payload.role) === 'SUPPORT'
          ? `${name} ya hace parte de tu red de apoyo.`
          : `${name} activó su propia ruta dentro de tu hogar. Su perfil sigue siendo independiente.`,
        '/app/familia',
        `invitation:${ref(payload, 'invitationId')}`,
      );
    }
    case 'household:contribution': {
      const id = ref(payload, 'contributionId');
      const goal = text(payload.goalTitle) || 'tu meta';
      if (status === 'DECLARED')
        return draft(
          'household',
          'Recibiste un aporte por confirmar',
          `${text(payload.contributorName) || 'Un integrante'} declaró un aporte a ${goal}. Confírmalo cuando lo recibas.`,
          '/app/familia',
          `contribution:${id}:${status}`,
        );
      if (status === 'CONFIRMED')
        return draft(
          'household',
          'Confirmaron tu aporte',
          `Tu aporte a ${goal} fue confirmado.`,
          '/app/familia',
          `contribution:${id}:${status}`,
        );
      if (status === 'REJECTED')
        return draft(
          'household',
          'Tu aporte no fue confirmado',
          `El aporte que declaraste a ${goal} no fue confirmado por quien administra la meta.`,
          '/app/familia',
          `contribution:${id}:${status}`,
        );
      return null;
    }
    case 'formalization:status': {
      const message = FORMALIZATION_MESSAGES[status];
      if (!message) return null;
      return draft(
        'formalization',
        message[0],
        message[1],
        '/app/formalizacion',
        `${ref(payload, 'caseId')}:${status}:${ref(payload, 'eventId')}`,
      );
    }
    case 'cards:guidance': {
      const title = text(payload.title);
      if (!title) return null;
      return draft(
        'guidance',
        title,
        text(payload.body) ||
          'Tienes una recomendación nueva para el uso de tu tarjeta.',
        '/app/finanzas',
        `guidance:${ref(payload, 'guidanceId')}`,
      );
    }
    default:
      return null;
  }
}
