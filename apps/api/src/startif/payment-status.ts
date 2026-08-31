export function mercadoPagoPaymentStatus(rawStatus: unknown) {
  const raw = String(rawStatus ?? '').toLowerCase();
  if (raw.includes('refund')) return 'REFUNDED' as const;
  if (raw.includes('expire')) return 'EXPIRED' as const;
  if (raw.includes('approved') || raw.includes('processed'))
    return 'APPROVED' as const;
  if (raw.includes('reject')) return 'REJECTED' as const;
  if (raw.includes('cancel')) return 'CANCELLED' as const;
  return 'PROCESSING' as const;
}
