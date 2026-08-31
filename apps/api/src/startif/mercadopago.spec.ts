import { mercadoPagoPaymentStatus } from './payment-status';

describe('mercadoPagoPaymentStatus', () => {
  it.each([
    ['approved', 'APPROVED'],
    ['processed', 'APPROVED'],
    ['rejected', 'REJECTED'],
    ['cancelled', 'CANCELLED'],
    ['expired', 'EXPIRED'],
    ['refunded', 'REFUNDED'],
    ['in_process', 'PROCESSING'],
  ])('normaliza %s como %s', (providerStatus, expected) => {
    expect(mercadoPagoPaymentStatus(providerStatus)).toBe(expected);
  });
});
