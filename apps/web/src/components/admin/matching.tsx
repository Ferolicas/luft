"use client";

import { type FormEvent, useEffect, useState } from "react";
import { forgetPeople } from "@/components/admin/people";
import { Badge, Button, ConfirmDialog, DataTable, Empty, ErrorBox, Field, FormActions, Loaded, Modal, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { cop, date, fractionFromPercent, numberOrNull } from "@/lib/admin/format";
import { get, type Problem, problemOf, send } from "@/lib/admin/http";
import { label } from "@/lib/admin/labels";
import type { DecisionBody, ExplainedRule, Explanation, MatchingCatalog, PartnerLink, Totals } from "@/lib/admin/matching-types";
import { ROLE_LABEL } from "@/lib/admin/nav";

let catalogCache: Promise<MatchingCatalog> | null = null;

/** Catálogo de campos, operadores y estados del motor (`GET /admin/matching/catalog`), una sola vez por sesión. */
export function useMatchingCatalog() {
  const [catalog, setCatalog] = useState<MatchingCatalog | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  useEffect(() => {
    let alive = true;
    catalogCache ??= get<MatchingCatalog>("/admin/matching/catalog").catch((cause) => { catalogCache = null; throw cause; });
    catalogCache.then((result) => { if (alive) setCatalog(result); }).catch((cause) => { if (alive) setProblem(problemOf(cause)); });
    return () => { alive = false; };
  }, []);
  return { catalog, problem };
}

const OUTCOME_TEXT: Record<string, string> = { CUMPLE: "Cumple", NO_CUMPLE: "No cumple", DATO_FALTANTE: "Dato faltante", EXCLUYE: "Excluye" };

function RuleOutcome({ rule }: { rule: ExplainedRule }) {
  return (
    <div className="cs-outcome">
      <StatusBadge value={rule.outcome} text={OUTCOME_TEXT[rule.outcome] ?? rule.outcome} />
      <strong>
        {rule.label} <span className="cs-muted" style={{ fontWeight: 600 }}>· {label(rule.kind)}{rule.weight ? ` · peso ${rule.weight}` : ""}</span>
        {rule.internal && <> <Badge>Interna</Badge></>}
        {rule.blocking && <> <Badge tone="bad">Bloquea</Badge></>}
        {rule.exceptionAllowed && <> <Badge tone="warn">Admite excepción</Badge></>}
      </strong>
      <p>
        {rule.message}
        {rule.expectedText && <> · Esperado: {rule.expectedText}</>}
        {rule.actualText && <> · Dato evaluado: {rule.actualText}</>}
      </p>
    </div>
  );
}

/** Explicación de un resultado: reglas cumplidas, brechas y exclusiones. */
export function ExplanationView({ explanation, totals }: { explanation: Explanation; totals?: Totals }) {
  const sections: Array<{ title: string; rules: ExplainedRule[]; empty: string }> = [
    { title: "Exclusiones", rules: explanation.exclusions, empty: "" },
    { title: "Brechas", rules: explanation.gaps, empty: "" },
    { title: "Reglas cumplidas", rules: explanation.passed, empty: "" },
  ];
  const any = sections.some((section) => section.rules.length > 0);
  return (
    <div className="cs-stack" style={{ gap: 12 }}>
      {totals && <div className="cs-chips"><Badge>{totals.rules} reglas</Badge><Badge tone="good">{totals.passed} cumplidas</Badge><Badge tone={totals.gaps > 0 ? "warn" : "neutral"}>{totals.gaps} brechas ({totals.blockingGaps} bloqueantes)</Badge><Badge tone={totals.missingData > 0 ? "warn" : "neutral"}>{totals.missingData} con dato faltante</Badge><Badge tone={totals.exclusions > 0 ? "bad" : "neutral"}>{totals.exclusions} exclusiones</Badge></div>}
      {!any && <p className="cs-muted">La política no tiene reglas evaluadas.</p>}
      {sections.filter((section) => section.rules.length > 0).map((section) => (
        <div key={section.title}>
          <strong className="cs-small" style={{ textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>{section.title} ({section.rules.length})</strong>
          {section.rules.map((rule) => <RuleOutcome key={rule.ruleId} rule={rule} />)}
        </div>
      ))}
    </div>
  );
}

/** Registro de la decisión de la entidad: aprobación con monto, tasa, plazo y producto final, o rechazo/desistimiento con motivo. */
export function DecisionForm({ productName, allowWithdraw = true, onSubmit, onClose }: { productName: string; allowWithdraw?: boolean; onSubmit: (body: DecisionBody) => Promise<void>; onClose: () => void }) {
  const [decision, setDecision] = useState<"APROBADA" | "RECHAZADA" | "DESISTIDA">("APROBADA");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [term, setTerm] = useState("");
  const [finalProduct, setFinalProduct] = useState(productName);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const approved = decision === "APROBADA";
  const amountValue = numberOrNull(amount);
  const reasonError = !approved && reason.trim().length > 0 && reason.trim().length < 5 ? "Escribe al menos 5 caracteres." : null;

  const body = (): DecisionBody => approved
    ? { decision, approvedAmountCOP: amountValue ?? 0, approvedRateEA: fractionFromPercent(rate) ?? 0, approvedTermMonths: numberOrNull(term) ?? 0, finalProductName: finalProduct.trim() || undefined, reason: reason.trim() || undefined }
    : { decision, reason: reason.trim() };

  return (
    <Modal title="Registrar la decisión de la entidad" description="La decisión es definitiva y la persona la verá en su app." onClose={onClose}>
      <form className="cs-form" onSubmit={(event: FormEvent) => { event.preventDefault(); setConfirming(true); }}>
        <div className="cs-option-checks" role="radiogroup" aria-label="Decisión">
          <label className={approved ? "on" : ""}><input type="radio" name="decision" checked={approved} onChange={() => setDecision("APROBADA")} /> Aprobada</label>
          <label className={decision === "RECHAZADA" ? "on" : ""}><input type="radio" name="decision" checked={decision === "RECHAZADA"} onChange={() => setDecision("RECHAZADA")} /> Rechazada</label>
          {allowWithdraw && <label className={decision === "DESISTIDA" ? "on" : ""}><input type="radio" name="decision" checked={decision === "DESISTIDA"} onChange={() => setDecision("DESISTIDA")} /> Desistida</label>}
        </div>
        {approved ? (
          <div className="cs-fields">
            <Field label="Monto aprobado (COP)" required hint={amountValue ? cop(amountValue) : "Pesos enteros."}><input type="number" min={1} step={1} value={amount} onChange={(event) => setAmount(event.target.value)} required /></Field>
            <Field label="Tasa efectiva anual (%)" required hint="Ej.: 24,5."><input type="number" min={0} max={500} step="0.0001" value={rate} onChange={(event) => setRate(event.target.value)} required /></Field>
            <Field label="Plazo (meses)" required><input type="number" min={1} max={480} step={1} value={term} onChange={(event) => setTerm(event.target.value)} required /></Field>
            <Field label="Producto final" hint="Nombre del producto que la entidad otorgó."><input value={finalProduct} onChange={(event) => setFinalProduct(event.target.value)} maxLength={160} /></Field>
            <Field label="Observación" wide hint="Opcional."><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} rows={2} /></Field>
          </div>
        ) : (
          <Field label={decision === "RECHAZADA" ? "Motivo del rechazo" : "Motivo del desistimiento"} required error={reasonError} hint="Mínimo 5 caracteres. La persona verá este motivo.">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={2000} rows={3} required />
          </Field>
        )}
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Continuar" disabled={Boolean(reasonError)} />
      </form>
      {confirming && (
        <ConfirmDialog
          title="Confirmar la decisión"
          confirmLabel={approved ? "Registrar aprobación" : decision === "RECHAZADA" ? "Registrar rechazo" : "Registrar desistimiento"}
          danger={!approved}
          onClose={() => setConfirming(false)}
          onConfirm={async () => { await onSubmit(body()); onClose(); }}
        >
          {approved
            ? <p>Se registrará la <strong>aprobación</strong> por <strong>{cop(amountValue)}</strong> a <strong>{rate} % E.A.</strong> y <strong>{term} meses</strong>.</p>
            : <p>Se registrará que la solicitud fue <strong>{decision === "RECHAZADA" ? "rechazada" : "desistida"}</strong>.</p>}
          <p>Una vez registrada no se puede cambiar.</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

/** Cuentas vinculadas a una entidad o a un aliado (solo superadministración). */
export function PartnerUsers({ listPath, unlinkPath, partnerLabel, roleLabel, onChanged }: { listPath: string; unlinkPath: string; partnerLabel: string; roleLabel: string; onChanged?: () => void }) {
  const links = useLoad(() => get<{ items: PartnerLink[] }>(listPath), [listPath]);
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<PartnerLink | null>(null);
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => {
      const result = await send<{ items: PartnerLink[] }>("POST", listPath, { email: email.trim().toLowerCase() });
      links.setData(result);
      setEmail("");
      forgetPeople();
      onChanged?.();
    });
  };
  return (
    <Panel flush title="Cuentas con acceso al portal" description={`Vincular una cuenta existente le asigna el rol «${roleLabel}» y le abre únicamente el portal de ${partnerLabel}. Desvincularla la devuelve a persona usuaria.`}>
      <form className="cs-toolbar" onSubmit={submit}>
        <label>
          Correo de la cuenta
          <input type="email" placeholder="persona@entidad.com" value={email} onChange={(event) => setEmail(event.target.value)} style={{ width: 280 }} required />
        </label>
        <Button type="submit" disabled={action.busy}>{action.busy ? "Vinculando…" : "Vincular cuenta"}</Button>
      </form>
      <ErrorBox problem={action.problem} />
      <Loaded loader={links} label="Cargando cuentas…">
        {(data) => (
          <DataTable
            caption="Cuentas vinculadas"
            rows={data.items}
            rowKey={(row) => row.id}
            empty={<Empty title="Sin cuentas vinculadas">La persona debe registrarse primero en LUFT; después vincúlala aquí con su correo.</Empty>}
            columns={[
              { key: "name", header: "Cuenta", cell: (row) => <div className="cs-cell"><strong>{row.fullName}</strong><small>{row.email}</small></div> },
              { key: "role", header: "Rol", cell: (row) => ROLE_LABEL[row.role] ?? row.role },
              { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} text={label(row.status, { ACTIVE: "Activa" })} /> },
              { key: "since", header: "Vinculada", cell: (row) => date(row.createdAt) },
              { key: "actions", header: "", align: "right", cell: (row) => <Button small variant="ghost" className="cs-btn-danger-text" onClick={() => setRemoving(row)}>Desvincular</Button> },
            ]}
          />
        )}
      </Loaded>
      {removing && (
        <ConfirmDialog
          title="Desvincular la cuenta"
          confirmLabel="Desvincular"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await send("DELETE", `${unlinkPath}/${removing.id}`);
            forgetPeople();
            await links.reload();
            onChanged?.();
          }}
        >
          <p><strong>{removing.fullName}</strong> perderá el acceso al portal de {partnerLabel} y su cuenta volverá a ser de persona usuaria.</p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}
