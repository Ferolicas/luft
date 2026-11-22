"use client";

import { CopyPlus, Pause, Play } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { PlanTable } from "@/components/admin/plan-table";
import { Badge, Button, Check, ConfirmDialog, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Panel, StatusBadge, useAction, useLoad } from "@/components/admin/ui";
import { type CreditProduct, PRODUCT_CODE_LABEL } from "@/lib/admin/credit-types";
import { cop, date, decimal, fractionFromPercent, numberOrNull, percent, percentInput } from "@/lib/admin/format";
import { get, plainIssue, send } from "@/lib/admin/http";
import { label, PRODUCT_STATUS_LABEL } from "@/lib/admin/labels";
import { can } from "@/lib/admin/nav";

const amountText = (product: CreditProduct) =>
  product.principalCOP !== null ? cop(product.principalCOP) : product.minPrincipalCOP !== null && product.maxPrincipalCOP !== null ? `${cop(product.minPrincipalCOP)} a ${cop(product.maxPrincipalCOP)}` : "Sin definir";

export default function CreditProductsPage() {
  const { user, notify } = useConsole();
  const products = useLoad(() => get<{ items: CreditProduct[] }>("/admin/credit-products"), []);
  const [editing, setEditing] = useState<CreditProduct | null>(null);
  const [transition, setTransition] = useState<{ product: CreditProduct; action: "activate" | "suspend" } | null>(null);
  const [preview, setPreview] = useState<CreditProduct | null>(null);
  const canManage = can("manageCreditProducts", user.role);

  return (
    <>
      <PageHead
        eyebrow="Crédito STARTIF"
        title="Productos de crédito"
        description="Las condiciones de cada crédito viven en versiones. Editar crea una versión nueva en borrador que hereda la anterior; solo una versión por producto está vigente y las solicitudes ya firmadas conservan la suya."
      />
      <Loaded loader={products} label="Cargando productos…">
        {(data) => {
          const codes = [...new Set(data.items.map((item) => item.code))];
          return (
            <>
              {codes.map((code) => {
                const versions = data.items.filter((item) => item.code === code).sort((a, b) => b.version - a.version);
                const active = versions.find((item) => item.status === "ACTIVE") ?? null;
                const latest = versions[0];
                return (
                  <Panel
                    key={code}
                    flush
                    title={<>{latest.name} <span className="cs-muted" style={{ fontWeight: 600 }}>· {PRODUCT_CODE_LABEL[code] ?? code}</span></>}
                    description={latest.description}
                    actions={
                      <>
                        {active ? <Badge tone="good">Vigente: versión {active.version}</Badge> : <Badge tone="warn">Sin versión vigente: no se puede solicitar</Badge>}
                        {canManage && <Button small onClick={() => setEditing(latest)}><CopyPlus size={15} /> Nueva versión</Button>}
                      </>
                    }
                  >
                    <div className="cs-table-wrap">
                      <table className="cs-table">
                        <caption>Versiones de {latest.name}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Versión</th>
                            <th scope="col">Estado</th>
                            <th scope="col" className="is-right">Monto</th>
                            <th scope="col" className="is-right">Plazo</th>
                            <th scope="col" className="is-right">Tasa mensual</th>
                            <th scope="col" className="is-right">Gradiente</th>
                            <th scope="col">Vigencia</th>
                            <th scope="col">Motivo / pendientes</th>
                            <th scope="col" />
                          </tr>
                        </thead>
                        <tbody>
                          {versions.map((product) => (
                            <tr key={product.id}>
                              <td><strong>v{product.version}</strong><div className="cs-muted cs-small">{date(product.createdAt)}</div></td>
                              <td><StatusBadge value={product.status} labels={PRODUCT_STATUS_LABEL} /></td>
                              <td className="is-right">{amountText(product)}</td>
                              <td className="is-right">{product.termMonths === null ? "Sin definir" : `${product.termMonths} meses`}</td>
                              <td className="is-right">{product.monthlyRate === null ? "Sin definir" : percent(product.monthlyRate)}</td>
                              <td className="is-right">{product.geometricDecrease === null ? "Sin definir" : percent(product.geometricDecrease)}</td>
                              <td>{product.effectiveFrom ? `${date(product.effectiveFrom)}${product.effectiveTo ? ` → ${date(product.effectiveTo)}` : " → hoy"}` : "—"}</td>
                              <td style={{ maxWidth: 300 }}>
                                {product.statusReason && <div className="cs-small">{product.statusReason}</div>}
                                {product.status !== "ACTIVE" && product.status !== "SUPERSEDED" && product.activationIssues.length > 0 && (
                                  <ul className="cs-small" style={{ margin: 0, paddingLeft: 16, listStyle: "disc", color: "#855409" }}>{product.activationIssues.map((issue) => <li key={issue}>{plainIssue(issue)}</li>)}</ul>
                                )}
                                {!product.statusReason && product.activationIssues.length === 0 && <span className="cs-muted">—</span>}
                              </td>
                              <td>
                                <div className="cs-actions">
                                  <Button variant="ghost" small onClick={() => setPreview(product)}>Condiciones</Button>
                                  {canManage && (product.status === "DRAFT" || product.status === "SUSPENDED") && <Button small onClick={() => setTransition({ product, action: "activate" })}><Play size={14} /> Activar</Button>}
                                  {canManage && product.status === "ACTIVE" && <Button variant="ghost" small className="cs-btn-danger-text" onClick={() => setTransition({ product, action: "suspend" })}><Pause size={14} /> Suspender</Button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                );
              })}
            </>
          );
        }}
      </Loaded>
      {editing && (
        <VersionForm
          previous={editing}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            setEditing(null);
            notify(`Versión ${created.version} de ${created.name} creada en borrador.`);
            await products.reload();
          }}
        />
      )}
      {preview && <ProductPreview product={preview} onClose={() => setPreview(null)} />}
      {transition && (
        <ConfirmDialog
          title={transition.action === "activate" ? `Activar la versión ${transition.product.version}` : `Suspender la versión ${transition.product.version}`}
          confirmLabel={transition.action === "activate" ? "Activar versión" : "Suspender producto"}
          danger={transition.action === "suspend"}
          reason={{ label: "Motivo", min: 5, placeholder: transition.action === "activate" ? "Ej.: condiciones aprobadas por el comité de crédito del 22 de noviembre." : "Ej.: revisión de la política de riesgo." }}
          onClose={() => setTransition(null)}
          onConfirm={async (reason) => {
            await send("POST", `/admin/credit-products/${transition.product.id}/${transition.action}`, { reason });
            notify(transition.action === "activate" ? `${transition.product.name} v${transition.product.version} quedó vigente.` : `${transition.product.name} quedó suspendido.`);
            await products.reload();
          }}
        >
          {transition.action === "activate" ? (
            <p>La versión <strong>{transition.product.version}</strong> de <strong>{transition.product.name}</strong> pasará a ser la vigente para las solicitudes nuevas. La versión vigente anterior quedará como sustituida. Las solicitudes ya firmadas no cambian.</p>
          ) : (
            <p>Mientras esté suspendido, nadie podrá iniciar una solicitud nueva de <strong>{transition.product.name}</strong>. Los créditos vigentes no cambian.</p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function ProductPreview({ product, onClose }: { product: CreditProduct; onClose: () => void }) {
  const fixed = product.principalCOP !== null;
  const requirements = product.requirements;
  return (
    <Modal title={`${product.name} · versión ${product.version}`} description={PRODUCT_STATUS_LABEL[product.status]} size="lg" onClose={onClose}>
      <Facts
        columns={3}
        items={[
          { label: "Monto", value: amountText(product) },
          { label: "Plazo", value: product.termMonths === null ? "Sin definir" : `${product.termMonths} cuotas mensuales` },
          { label: "Tasa mensual vencida", value: product.monthlyRate === null ? "Sin definir" : percent(product.monthlyRate) },
          { label: "Gradiente geométrico", value: product.geometricDecrease === null ? "Sin definir" : `${percent(product.geometricDecrease)} decreciente` },
          { label: "Pasa a mora a los", value: `${product.defaultAfterDays} días de atraso` },
          { label: "Desembolso", value: label(product.disbursementMode) },
        ]}
      />
      {requirements && (
        <div className="cs-fieldset">
          <strong>Requisitos del segundo crédito</strong>
          <Facts
            columns={2}
            items={[
              { label: "Crédito 1 totalmente pagado", value: requirements.firstCreditMustBePaid ? "Obligatorio" : "No se exige" },
              { label: "Máximo de cuotas pagadas tarde en el crédito 1", value: String(requirements.maxLatePayments) },
              { label: "Cobertura de capacidad", value: `${decimal(requirements.capacityCoverage)} veces la cuota más alta` },
              { label: "Tope de endeudamiento", value: requirements.maxDebtToMonthlyIncome === null ? "Sin definir" : `${decimal(requirements.maxDebtToMonthlyIncome)} veces el ingreso mensual` },
            ]}
          />
        </div>
      )}
      {fixed ? (
        <PlanTable principalCOP={product.principalCOP} termMonths={product.termMonths} monthlyRate={product.monthlyRate} geometricDecrease={product.geometricDecrease} />
      ) : product.minPrincipalCOP !== null && product.maxPrincipalCOP !== null ? (
        <div className="cs-grid cs-grid-2">
          <div className="cs-stack" style={{ gap: 6 }}><strong className="cs-small">Plan con el monto mínimo</strong><PlanTable principalCOP={product.minPrincipalCOP} termMonths={product.termMonths} monthlyRate={product.monthlyRate} geometricDecrease={product.geometricDecrease} /></div>
          <div className="cs-stack" style={{ gap: 6 }}><strong className="cs-small">Plan con el monto máximo</strong><PlanTable principalCOP={product.maxPrincipalCOP} termMonths={product.termMonths} monthlyRate={product.monthlyRate} geometricDecrease={product.geometricDecrease} /></div>
        </div>
      ) : <p className="cs-note cs-note-warn">Esta versión aún no tiene monto definido.</p>}
    </Modal>
  );
}

function VersionForm({ previous, onClose, onSaved }: { previous: CreditProduct; onClose: () => void; onSaved: (created: CreditProduct) => Promise<void> }) {
  const second = previous.sequence === 2;
  const [name, setName] = useState(previous.name);
  const [description, setDescription] = useState(previous.description ?? "");
  const [mode, setMode] = useState<"fixed" | "range">(previous.principalCOP === null && previous.minPrincipalCOP !== null ? "range" : "fixed");
  const [principal, setPrincipal] = useState(previous.principalCOP?.toString() ?? "");
  const [minPrincipal, setMinPrincipal] = useState(previous.minPrincipalCOP?.toString() ?? "");
  const [maxPrincipal, setMaxPrincipal] = useState(previous.maxPrincipalCOP?.toString() ?? "");
  const [term, setTerm] = useState(previous.termMonths?.toString() ?? "");
  const [rate, setRate] = useState(percentInput(previous.monthlyRate));
  const [decrease, setDecrease] = useState(percentInput(previous.geometricDecrease));
  const [defaultAfter, setDefaultAfter] = useState(String(previous.defaultAfterDays));
  const [firstPaid, setFirstPaid] = useState(previous.requirements?.firstCreditMustBePaid ?? true);
  const [maxLate, setMaxLate] = useState(String(previous.requirements?.maxLatePayments ?? 1));
  const [coverage, setCoverage] = useState(String(previous.requirements?.capacityCoverage ?? 1));
  const [debtCap, setDebtCap] = useState(previous.requirements?.maxDebtToMonthlyIncome?.toString() ?? "");
  const action = useAction();

  const values = useMemo(() => ({
    principal: numberOrNull(principal), min: numberOrNull(minPrincipal), max: numberOrNull(maxPrincipal), term: numberOrNull(term),
    rate: fractionFromPercent(rate), decrease: fractionFromPercent(decrease),
  }), [principal, minPrincipal, maxPrincipal, term, rate, decrease]);
  const rangeError = mode === "range" && values.min !== null && values.max !== null && values.min > values.max ? "El mínimo no puede superar el máximo." : null;
  const previewPrincipal = mode === "fixed" ? values.principal : values.max;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rangeError) return;
    const body: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      principalCOP: mode === "fixed" ? values.principal : null,
      minPrincipalCOP: mode === "range" ? values.min : null,
      maxPrincipalCOP: mode === "range" ? values.max : null,
      termMonths: values.term,
      monthlyRate: values.rate,
      geometricDecrease: values.decrease,
      defaultAfterDays: numberOrNull(defaultAfter) ?? previous.defaultAfterDays,
    };
    if (second)
      body.requirements = {
        firstCreditMustBePaid: firstPaid,
        maxLatePayments: numberOrNull(maxLate) ?? 0,
        capacityCoverage: numberOrNull(coverage) ?? 1,
        maxDebtToMonthlyIncome: numberOrNull(debtCap),
      };
    await action.run(async () => onSaved(await send<CreditProduct>("POST", `/admin/credit-products/${previous.code}/versions`, body)));
  };

  return (
    <Modal title={`Nueva versión de ${previous.name}`} description={`Hereda las condiciones de la versión ${previous.version}. Se crea en borrador: no afecta nada hasta que la actives.`} size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields">
          <Field label="Nombre del producto" required><input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={120} required /></Field>
          <Field label="Días de atraso para pasar a mora" required hint="Entre 1 y 360."><input type="number" min={1} max={360} value={defaultAfter} onChange={(event) => setDefaultAfter(event.target.value)} required /></Field>
          <Field label="Descripción" wide><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></Field>
        </div>
        <fieldset className="cs-fieldset">
          <legend>Monto</legend>
          <div className="cs-option-checks" role="radiogroup" aria-label="Tipo de monto">
            <label className={mode === "fixed" ? "on" : ""}><input type="radio" name="amount-mode" checked={mode === "fixed"} onChange={() => setMode("fixed")} /> Monto fijo</label>
            <label className={mode === "range" ? "on" : ""}><input type="radio" name="amount-mode" checked={mode === "range"} onChange={() => setMode("range")} /> Rango (la persona elige)</label>
          </div>
          {mode === "fixed" ? (
            <div className="cs-fields">
              <Field label="Capital (COP)" hint={values.principal ? cop(values.principal) : "Pesos enteros."}><input type="number" min={1} step={1} value={principal} onChange={(event) => setPrincipal(event.target.value)} /></Field>
            </div>
          ) : (
            <div className="cs-fields">
              <Field label="Monto mínimo (COP)" hint={values.min ? cop(values.min) : "Pesos enteros."}><input type="number" min={1} step={1} value={minPrincipal} onChange={(event) => setMinPrincipal(event.target.value)} /></Field>
              <Field label="Monto máximo (COP)" hint={values.max ? cop(values.max) : "Pesos enteros."} error={rangeError}><input type="number" min={1} step={1} value={maxPrincipal} onChange={(event) => setMaxPrincipal(event.target.value)} /></Field>
            </div>
          )}
        </fieldset>
        <div className="cs-fields cs-fields-3">
          <Field label="Plazo (meses)" hint="Entre 1 y 120."><input type="number" min={1} max={120} step={1} value={term} onChange={(event) => setTerm(event.target.value)} /></Field>
          <Field label="Tasa mensual vencida (%)" hint="Máximo 10 %. Se valida contra la tasa legal."><input type="number" min={0} max={10} step="0.0001" value={rate} onChange={(event) => setRate(event.target.value)} /></Field>
          <Field label="Gradiente decreciente (%)" hint="Cada cuota baja ese porcentaje frente a la anterior."><input type="number" min={0} max={95} step="0.0001" value={decrease} onChange={(event) => setDecrease(event.target.value)} /></Field>
        </div>
        {second && (
          <fieldset className="cs-fieldset">
            <legend>Requisitos de elegibilidad</legend>
            <Check label="El crédito 1 debe estar totalmente pagado" checked={firstPaid} onChange={setFirstPaid} />
            <div className="cs-fields cs-fields-3">
              <Field label="Máx. cuotas pagadas tarde" hint="Del crédito 1."><input type="number" min={0} max={120} step={1} value={maxLate} onChange={(event) => setMaxLate(event.target.value)} required /></Field>
              <Field label="Cobertura de capacidad" hint="Veces que la capacidad cubre la cuota más alta (1 a 10)."><input type="number" min={1} max={10} step="0.01" value={coverage} onChange={(event) => setCoverage(event.target.value)} required /></Field>
              <Field label="Tope de endeudamiento" hint="Deuda total proyectada ÷ ingreso mensual. Obligatorio para activar."><input type="number" min={0.01} max={120} step="0.01" value={debtCap} onChange={(event) => setDebtCap(event.target.value)} /></Field>
            </div>
          </fieldset>
        )}
        {previewPrincipal !== null && values.term !== null && values.rate !== null && values.decrease !== null && (
          <details open>
            <summary className="cs-link" style={{ cursor: "pointer" }}>Vista previa del plan de cuotas{mode === "range" ? " (con el monto máximo)" : ""}</summary>
            <div style={{ marginTop: 10 }}><PlanTable principalCOP={previewPrincipal} termMonths={values.term} monthlyRate={values.rate} geometricDecrease={values.decrease} /></div>
          </details>
        )}
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Crear versión en borrador" disabled={Boolean(rangeError)} />
      </form>
    </Modal>
  );
}
