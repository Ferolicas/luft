"use client";

import { cop, day, percent } from "@/lib/admin/format";
import { annualEffective, geometricPlan, planTotals } from "@/lib/admin/credit-plan";

/** Plan de cuotas calculado con las condiciones dadas (capital, plazo, tasa mensual y gradiente). */
export function PlanTable({ principalCOP, termMonths, monthlyRate, geometricDecrease, startDate, estimated = true }: { principalCOP: number | null; termMonths: number | null; monthlyRate: number | null; geometricDecrease: number | null; startDate?: string | null; /** `false` cuando `startDate` es la fecha real de desembolso. */ estimated?: boolean }) {
  if (principalCOP === null || termMonths === null || monthlyRate === null || geometricDecrease === null)
    return <p className="cs-note cs-note-warn">Faltan condiciones (monto, plazo, tasa o gradiente) para calcular el plan de cuotas.</p>;
  const rows = geometricPlan(principalCOP, termMonths, monthlyRate, geometricDecrease, startDate);
  if (rows.length === 0) return <p className="cs-note cs-note-warn">Las condiciones no producen un plan de cuotas válido.</p>;
  const totals = planTotals(rows);
  return (
    <div className="cs-stack" style={{ gap: 8 }}>
      <div className="cs-table-wrap">
        <table className="cs-table cs-table-compact">
          <caption>Plan de cuotas</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              {startDate && <th scope="col">Vence</th>}
              <th scope="col" className="is-right">Cuota</th>
              <th scope="col" className="is-right">Capital</th>
              <th scope="col" className="is-right">Interés</th>
              <th scope="col" className="is-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sequence}>
                <td>{row.sequence}</td>
                {startDate && <td>{day(row.dueDate)}</td>}
                <td className="is-right"><strong>{cop(row.amountCOP)}</strong></td>
                <td className="is-right">{cop(row.principalCOP)}</td>
                <td className="is-right">{cop(row.interestCOP)}</td>
                <td className="is-right">{cop(row.closingBalanceCOP)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={startDate ? 2 : 1}>Total</td>
              <td className="is-right">{cop(totals.totalCOP)}</td>
              <td className="is-right">{cop(principalCOP)}</td>
              <td className="is-right">{cop(totals.totalInterestCOP)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <small className="cs-muted cs-small">
        Tasa {percent(monthlyRate)} mensual vencida ({percent(annualEffective(monthlyRate))} E.A.), gradiente geométrico decreciente del {percent(geometricDecrease)} mensual.
        {startDate ? (estimated ? " Las fechas se cuentan desde la activación o el desembolso; aquí se estiman desde hoy." : " Fechas contadas desde el desembolso registrado.") : ""}
      </small>
    </div>
  );
}
