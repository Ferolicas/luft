/**
 * Operaciones de cartera compartidas por la API (webhook de pagos) y el worker
 * (job diario). Siempre corren dentro de una transacción del esquema startif.
 */
import type { Prisma } from '../generated/startif/client';
import {
  assertTransition,
  bogotaDate,
  resolveLoanStatus,
} from './credit-lifecycle';
import { outstandingPrincipal } from './prepayment';

type Tx = Prisma.TransactionClient;

/**
 * Bloquea la fila del préstamo hasta el final de la transacción, para que dos
 * confirmaciones de pago simultáneas no recalculen el mismo plan a la vez.
 */
export async function lockLoan(tx: Tx, loanId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "startif"."Loan" WHERE "id" = ${loanId}::uuid FOR UPDATE`;
}

export interface LoanSyncResult {
  loanId: string;
  applicationId: string;
  userId: string;
  previousStatus: string;
  status: string;
  /** El préstamo quedó pagado en esta operación. */
  closed: boolean;
  outstandingBalanceCOP: bigint;
}

/**
 * Deja el préstamo coherente con sus cuotas: saldo de capital, estado
 * (vigente, mora, pagado, castigado) y el estado espejo de la solicitud.
 */
export async function syncLoanStatus(
  tx: Tx,
  loanId: string,
  now: Date,
): Promise<LoanSyncResult> {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    include: { installments: true },
  });
  const status = resolveLoanStatus({
    current: loan.status,
    installments: loan.installments,
    today: bogotaDate(now),
    defaultAfterDays: loan.defaultAfterDays,
  });
  if (status !== loan.status) assertTransition(loan.status, status);
  const outstanding = BigInt(outstandingPrincipal(loan.installments));
  await tx.loan.update({
    where: { id: loan.id },
    data: {
      status,
      outstandingBalanceCOP: outstanding,
      closedAt: status === 'COMPLETED' ? (loan.closedAt ?? now) : null,
      defaultedAt:
        status === 'DEFAULTED'
          ? (loan.defaultedAt ?? now)
          : status === 'ACTIVE'
            ? null
            : loan.defaultedAt,
    },
  });
  await tx.creditApplication.update({
    where: { id: loan.applicationId },
    data: { status },
  });
  return {
    loanId: loan.id,
    applicationId: loan.applicationId,
    userId: loan.userId,
    previousStatus: loan.status,
    status,
    closed: status === 'COMPLETED' && loan.status !== 'COMPLETED',
    outstandingBalanceCOP: outstanding,
  };
}
