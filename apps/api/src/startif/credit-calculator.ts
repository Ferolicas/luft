import { addMonths } from 'date-fns';

export interface ScheduleRow {
  sequence: number;
  amountCOP: number;
  principalCOP: number;
  interestCOP: number;
  openingBalanceCOP: number;
  closingBalanceCOP: number;
  dueDate: string;
}

export function geometricSchedule(
  principal: number,
  months: number,
  monthlyRate: number,
  decrease = 0.15,
): ScheduleRow[] {
  if (!Number.isInteger(principal) || principal <= 0)
    throw new Error('Capital inválido');
  if (!Number.isInteger(months) || months < 1 || months > 120)
    throw new Error('Plazo inválido');
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 1)
    throw new Error('Tasa inválida');
  const q = 1 - decrease;
  const denominator = Array.from(
    { length: months },
    (_, index) => Math.pow(q, index) / Math.pow(1 + monthlyRate, index + 1),
  ).reduce((a, b) => a + b, 0);
  const firstPayment = principal / denominator;
  let balance = principal;
  return Array.from({ length: months }, (_, index) => {
    const interest = Math.round(balance * monthlyRate);
    const amount =
      index === months - 1
        ? Math.round(balance + interest)
        : Math.round(firstPayment * Math.pow(q, index));
    const principalPart =
      index === months - 1
        ? Math.round(balance)
        : Math.min(Math.round(balance), Math.max(0, amount - interest));
    const opening = Math.round(balance);
    balance = Math.max(0, balance - principalPart);
    return {
      sequence: index + 1,
      amountCOP: amount,
      principalCOP: principalPart,
      interestCOP: interest,
      openingBalanceCOP: opening,
      closingBalanceCOP: Math.round(balance),
      dueDate: addMonths(new Date(), index + 1)
        .toISOString()
        .slice(0, 10),
    };
  });
}
