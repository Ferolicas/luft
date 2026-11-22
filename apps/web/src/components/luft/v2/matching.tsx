"use client";

import Link from "next/link";
import { useState } from "react";
import { cop, errorCode, fmtDate, fmtDateTime, percentText, send, useAction, useResource } from "@/lib/v2/api";
import type { Tone } from "@/lib/v2/labels";
import type { AuthorizationPreview, ExplainedRule, MatchResult, Presentation, PresentationStatus } from "@/lib/v2/types";
import { Alert, Button, Checkbox, Chip, Icon, Sheet, Tip } from "../ui";
import { ConsentBox, Facts, Fold, Ring, SheetHead, StatusChip } from "./kit";

export const RESULT: Record<MatchResult["status"], [Tone, string]> = { ELEGIBLE: ["green", "Cumples los criterios"], CON_BRECHAS: ["amber", "Con brechas"], EXCLUIDO: ["red", "No aplica hoy"] };
export const PRESENTATION: Record<PresentationStatus, Tone> = { AUTORIZADA: "blue", REVOCADA: "", PRESENTADA: "violet", APROBADA: "green", RECHAZADA: "red", DESISTIDA: "" };
const INSTITUTION: Record<string, string> = { BANCO: "Banco", COMPANIA_FINANCIAMIENTO: "Compañía de financiamiento", COOPERATIVA: "Cooperativa", FINTECH: "Fintech", MICROFINANCIERA: "Microfinanciera", FONDO_EMPLEADOS: "Fondo de empleados", CAJA_COMPENSACION: "Caja de compensación", OTRA: "Entidad financiera" };
const PRODUCT: Record<string, string> = { LIBRE_INVERSION: "Libre inversión", TARJETA_CREDITO: "Tarjeta de crédito", VIVIENDA: "Vivienda", VEHICULO: "Vehículo", EDUCATIVO: "Crédito educativo", MICROCREDITO: "Microcrédito", LIBRANZA: "Libranza", OTRO: "Otro producto" };
const range = (min: number | null, max: number | null, format: (value: number) => string) => (min != null && max != null ? (min === max ? format(min) : `${format(min)} – ${format(max)}`) : min != null ? `Desde ${format(min)}` : max != null ? `Hasta ${format(max)}` : "—");

function Rule({ rule, tone }: { rule: ExplainedRule; tone: "ok" | "gap" | "out" }) {
  return (
    <li className={tone}>
      <Icon name={tone === "ok" ? "check_circle" : tone === "gap" ? "warning" : "close"} size={18} />
      <span className="l-grow">
        <strong>{rule.label}</strong>
        {rule.message}
        {tone !== "ok" && (rule.kind === "PREFERENCIA" || rule.outcome === "DATO_FALTANTE" || rule.exceptionAllowed) && (
          <span className="v2-wrap" style={{ marginTop: 6 }}>
            {rule.kind === "PREFERENCIA" && <Chip>Preferencia: no bloquea</Chip>}
            {rule.outcome === "DATO_FALTANTE" && !rule.internal && <Chip tone="amber">Dato faltante</Chip>}
            {rule.exceptionAllowed && <Chip tone="violet">Admite excepción</Chip>}
          </span>
        )}
        {rule.completeHref && <Link href={rule.completeHref}>Completar este dato<Icon name="arrow_forward" size={14} /></Link>}
      </span>
    </li>
  );
}

export function PresentationBlock({ item, busy, onRevoke }: { item: Presentation; busy: boolean; onRevoke: () => void }) {
  const tone = PRESENTATION[item.status];
  return (
    <div className="l-stack" style={{ gap: 10 }}>
      <div className="l-row between"><span className="l-small" style={{ fontWeight: 500 }}>Presentación a {item.institution.name}</span><StatusChip tone={tone}>{item.statusLabel}</StatusChip></div>
      <ol className="v2-timeline">
        {item.decidedAt && <li><strong>{item.status === "APROBADA" ? "La entidad aprobó" : item.status === "RECHAZADA" ? "La entidad no aprobó" : "Proceso cerrado"}</strong><small>{fmtDateTime(item.decidedAt)}</small>{item.decisionReason && <div className="note"><b>Motivo informado</b>{item.decisionReason}</div>}</li>}
        {item.presentedAt && <li><strong>LUFT presentó tus datos a la entidad</strong><small>{fmtDateTime(item.presentedAt)}</small></li>}
        {item.revokedAt && <li><strong>Revocaste la autorización</strong><small>{fmtDateTime(item.revokedAt)}</small></li>}
        <li><strong>Autorizaste la presentación</strong><small>{fmtDateTime(item.authorizedAt)}</small></li>
      </ol>
      {item.status === "APROBADA" && (
        <Facts columns={3} rows items={[
          { label: "Monto aprobado", value: item.approvedAmountCOP != null ? cop(item.approvedAmountCOP) : "—" },
          { label: "Tasa E.A.", value: percentText(item.approvedRateEA) || "—" },
          { label: "Plazo", value: item.approvedTermMonths != null ? `${item.approvedTermMonths} meses` : "—" },
        ]} />
      )}
      {item.status === "APROBADA" && item.finalProductName && <span className="l-small">Producto final: {item.finalProductName}. La entidad te contactará para formalizarlo.</span>}
      {item.status === "AUTORIZADA" && <span className="l-small">Aún no hemos compartido tus datos. Puedes revocar antes de que LUFT los presente.{item.requiresException ? " Este caso requiere una excepción antes de presentarse." : ""}</span>}
      {item.status === "PRESENTADA" && <span className="l-small">La entidad ya tiene los datos que autorizaste y decide según sus criterios. Puedes desistir del proceso.</span>}
      {item.canRevoke && <div className="v2-actions"><button type="button" className="v2-mini danger" disabled={busy} onClick={onRevoke}>{item.status === "PRESENTADA" ? "Desistir del proceso" : "Revocar autorización"}</button></div>}
    </div>
  );
}

export function ResultCard({ result, open, busy, onAuthorize, onRevoke }: { result: MatchResult; open: boolean; busy: boolean; onAuthorize: () => void; onRevoke: () => void }) {
  const [tone, label] = RESULT[result.status];
  const { product, totals, explanation } = result;
  return (
    <article className="l-card">
      <div className="v2-result-head">
        <Ring value={result.fitPercent} tone={tone} label="Encaje con la política" />
        <div className="l-grow"><h3>{product.name}</h3><small>{result.institution.name} · {INSTITUTION[result.institution.kind] ?? "Entidad"} · {PRODUCT[product.kind] ?? "Producto"}</small></div>
      </div>
      <div className="v2-wrap"><StatusChip tone={tone}>{label}</StatusChip><Chip>Encaje {result.fitPercent}%</Chip>{result.requiresException && <Chip tone="violet">Requiere excepción</Chip>}</div>
      <p className="v2-lead">{result.headline}</p>
      <Facts items={[
        { label: "Monto", value: range(product.minAmountCOP, product.maxAmountCOP, cop), hint: product.description ?? undefined },
        { label: "Plazo", value: product.minTermMonths != null && product.maxTermMonths != null && product.minTermMonths !== product.maxTermMonths ? `${product.minTermMonths} a ${product.maxTermMonths} meses` : range(product.minTermMonths, product.maxTermMonths, (value) => `${value} meses`) },
        ...(product.referenceRateEA != null ? [{ label: "Tasa de referencia", value: `${percentText(product.referenceRateEA)} E.A.`, hint: "Informativa: la define la entidad" }] : []),
        ...(product.channel ? [{ label: "Canal", value: product.channel }] : []),
      ]} />
      <span className="l-small">Política versión {result.policy.version}{result.policy.effectiveFrom ? ` · vigente desde el ${fmtDate(result.policy.effectiveFrom)}` : ""}</span>
      <Fold open={open} summary={`Por qué: ${totals.passed} de ${totals.rules} criterios cumplidos${totals.gaps ? ` · ${totals.gaps} por cumplir` : ""}${totals.exclusions ? ` · ${totals.exclusions} de exclusión` : ""}`}>
        {explanation.exclusions.length > 0 && <div><span className="l-overline" style={{ color: "var(--l-red-500)" }}>Exclusiones</span><ul className="v2-rules" style={{ marginTop: 8 }}>{explanation.exclusions.map((rule) => <Rule key={rule.ruleId} rule={rule} tone="out" />)}</ul></div>}
        {explanation.gaps.length > 0 && <div><span className="l-overline" style={{ color: "var(--l-amber-500)" }}>Brechas</span><ul className="v2-rules" style={{ marginTop: 8 }}>{explanation.gaps.map((rule) => <Rule key={rule.ruleId} rule={rule} tone="gap" />)}</ul></div>}
        {explanation.passed.length > 0 && <div><span className="l-overline" style={{ color: "var(--l-green-500)" }}>Reglas cumplidas</span><ul className="v2-rules" style={{ marginTop: 8 }}>{explanation.passed.map((rule) => <Rule key={rule.ruleId} rule={rule} tone="ok" />)}</ul></div>}
        {(product.requiredDocuments.length > 0 || product.guarantees.length > 0) && (
          <div className="v2-scope">
            {product.requiredDocuments.length > 0 && <div><h4>Documentos que pide la entidad</h4><ul>{product.requiredDocuments.map((item) => <li key={item}><Chip>{item}</Chip></li>)}</ul></div>}
            {product.guarantees.length > 0 && <div><h4>Garantías</h4><ul>{product.guarantees.map((item) => <li key={item}><Chip>{item}</Chip></li>)}</ul></div>}
          </div>
        )}
      </Fold>
      <hr className="l-divider" />
      {result.presentation
        ? <PresentationBlock item={result.presentation} busy={busy} onRevoke={onRevoke} />
        : result.authorization.allowed
          ? <><Button onClick={onAuthorize}>Autorizar presentación a {result.institution.name}</Button><span className="l-fine">Verás exactamente qué datos se comparten antes de aceptar. No es una aprobación.</span></>
          : <span className="v2-private"><Icon name="lock" size={16} />{result.authorization.blockedReason ?? "Este resultado no se puede presentar a la entidad."}</span>}
    </article>
  );
}

export function AuthorizeSheet({ result, onClose, onDone }: { result: MatchResult; onClose: () => void; onDone: (presentation: Presentation) => void }) {
  const preview = useResource<AuthorizationPreview>(`/matching/results/${result.id}/authorization`);
  const [accepted, setAccepted] = useState(false);
  const action = useAction();
  const data = preview.data;
  const authorize = () => action.run(async () => {
    try { onDone(await send<Presentation>("POST", `/matching/results/${result.id}/authorize`, { accepted: true, version: data!.version, textHash: data!.textHash })); }
    catch (cause) { if (errorCode(cause) === "authorization_text_changed") { setAccepted(false); await preview.reload(); } throw cause; }
  });
  const title = `Presentar mi perfil a ${result.institution.name}`;
  return (
    <Sheet title={title} onClose={onClose}>
      <SheetHead title={title}>Para el producto «{result.product.name}». Lee qué se comparte y con qué fin antes de aceptar.</SheetHead>
      {preview.failure ? <Alert>{preview.failure}</Alert> : !data ? <span className="l-small">Cargando el texto de la autorización…</span> : !data.allowed ? <Tip tone="amber" icon="lock" title="No se puede autorizar">{data.blockedReason}</Tip> : <>
        <div className="v2-scope">
          <div><h4>Tu identificación y contacto</h4><ul>{data.scope.identity.map((item) => <li key={item.key}><Chip tone="blue">{item.label}</Chip></li>)}</ul></div>
          <div><h4>Datos de tu perfil que evalúa esta política</h4><ul>{data.scope.facts.map((item) => <li key={item.key}><Chip tone="blue">{item.label}</Chip></li>)}</ul></div>
          <div><h4>Resultado del matching</h4><ul>{data.scope.match.map((item) => <li key={item.key}><Chip tone="blue">{item.label}</Chip></li>)}</ul></div>
        </div>
        <span className="v2-private"><Icon name="lock" size={16} />Nada más de tu perfil se comparte, y solo con {data.institution.name}.</span>
        <ConsentBox text={data.text} title={`Texto de la autorización · versión ${data.version}`} />
        <Checkbox checked={accepted} onChange={setAccepted}>Leí y autorizo expresamente esta presentación.</Checkbox>
        {result.requiresException && <Tip tone="amber" icon="info" title="Requiere una excepción">Hay un requisito que no cumples y que la política permite exceptuar. La presentación solo ocurre si esa excepción se aprueba.</Tip>}
      </>}
      {action.failure && <Alert>{action.failure}</Alert>}
      <Button disabled={!data?.allowed || !accepted || action.busy} onClick={authorize}>{action.busy ? "Registrando…" : "Autorizar presentación"}</Button>
      <p className="l-fine">Autorizar no es una aprobación ni garantiza un resultado: la decisión es de la entidad.</p>
      <button type="button" className="l-link-button" onClick={onClose}>Ahora no</button>
    </Sheet>
  );
}
