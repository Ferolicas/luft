"use client";

import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useConsole } from "@/components/app-shell";
import { Button, Cell, ConfirmDialog, DataTable, Empty, ErrorBox, Facts, Field, FormActions, Loaded, Modal, PageHead, Pager, Panel, StatusBadge, Toolbar, useAction, useLoad } from "@/components/admin/ui";
import { cop, date, day, integer, today } from "@/lib/admin/format";
import type { TaxRule } from "@/lib/admin/formalization-types";
import { get, type Paged, query, send } from "@/lib/admin/http";
import { TAX_RULE_STATUS_LABEL } from "@/lib/admin/labels";

const LIMITS: Array<{ key: "wealthUvt" | "incomeUvt" | "cardSpendUvt" | "purchasesUvt" | "depositsUvt"; label: string }> = [
  { key: "wealthUvt", label: "Patrimonio bruto" },
  { key: "incomeUvt", label: "Ingresos brutos" },
  { key: "cardSpendUvt", label: "Consumos con tarjeta" },
  { key: "purchasesUvt", label: "Compras y consumos" },
  { key: "depositsUvt", label: "Consignaciones e inversiones" },
];

export default function TaxRulesPage() {
  const { notify } = useConsole();
  const [taxYear, setTaxYear] = useState("");
  const [page, setPage] = useState(1);
  const rules = useLoad(() => get<Paged<TaxRule>>(`/admin/tax-rules${query({ taxYear, page })}`), [taxYear, page]);
  const [creating, setCreating] = useState<TaxRule | "blank" | null>(null);
  const [viewing, setViewing] = useState<TaxRule | null>(null);
  const [transition, setTransition] = useState<{ rule: TaxRule; action: "approve" | "activate" } | null>(null);

  return (
    <>
      <PageHead
        eyebrow="Formalización tributaria"
        title="Reglas tributarias"
        description="Topes para el diagnóstico de posible obligación de declarar renta, por año gravable. Cada cambio es una versión nueva con su fuente documental: se crea en borrador, se aprueba y luego se pone vigente. El diagnóstico es una orientación, nunca una determinación definitiva."
        actions={<Button onClick={() => setCreating(rules.data?.items[0] ?? "blank")}><Plus size={16} /> Nueva versión</Button>}
      />
      <Panel flush>
        <Toolbar>
          <label>
            Año gravable
            <input type="number" min={2020} max={2100} placeholder="Todos" value={taxYear} onChange={(event) => { setTaxYear(event.target.value); setPage(1); }} />
          </label>
        </Toolbar>
        <Loaded loader={rules} label="Cargando reglas…">
          {(data) => (
            <>
              <DataTable
                caption="Reglas tributarias"
                rows={data.items}
                rowKey={(row) => row.id}
                empty={<Empty title="No hay reglas para ese año">Sin una regla vigente del año gravable, el diagnóstico queda sin evaluar.</Empty>}
                columns={[
                  { key: "year", header: "Año gravable", cell: (row) => <Cell main={row.taxYear} sub={`Versión ${row.version}`} /> },
                  { key: "status", header: "Estado", cell: (row) => <StatusBadge value={row.status} labels={TAX_RULE_STATUS_LABEL} /> },
                  { key: "uvt", header: "UVT", align: "right", cell: (row) => cop(row.uvtCOP) },
                  { key: "wealth", header: "Patrimonio", align: "right", cell: (row) => <Cell main={`${integer(row.wealthUvt)} UVT`} sub={cop(row.wealthUvt * row.uvtCOP)} /> },
                  { key: "income", header: "Ingresos", align: "right", cell: (row) => <Cell main={`${integer(row.incomeUvt)} UVT`} sub={cop(row.incomeUvt * row.uvtCOP)} /> },
                  { key: "effective", header: "Vigencia", cell: (row) => `${day(row.effectiveFrom)}${row.effectiveTo ? ` → ${day(row.effectiveTo)}` : ""}` },
                  { key: "source", header: "Fuente documental", cell: (row) => <span className="cs-small" title={row.sourceDocument}>{row.sourceDocument.length > 90 ? `${row.sourceDocument.slice(0, 90)}…` : row.sourceDocument}</span> },
                  {
                    key: "actions",
                    header: "",
                    align: "right",
                    cell: (row) => (
                      <div className="cs-actions">
                        <Button small variant="ghost" onClick={() => setViewing(row)}>Ver</Button>
                        {row.status === "DRAFT" && <Button small onClick={() => setTransition({ rule: row, action: "approve" })}>Aprobar</Button>}
                        {row.status === "APPROVED" && <Button small onClick={() => setTransition({ rule: row, action: "activate" })}>Poner vigente</Button>}
                        <Button small variant="quiet" onClick={() => setCreating(row)}>Nueva versión</Button>
                      </div>
                    ),
                  },
                ]}
              />
              <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} noun="versiones" />
            </>
          )}
        </Loaded>
      </Panel>
      {creating && (
        <RuleForm
          base={creating === "blank" ? null : creating}
          onClose={() => setCreating(null)}
          onSaved={async (rule) => {
            setCreating(null);
            notify(`Regla ${rule.taxYear} versión ${rule.version} creada en borrador.`);
            await rules.reload();
          }}
        />
      )}
      {viewing && (
        <Modal title={`Año gravable ${viewing.taxYear} · versión ${viewing.version}`} description={TAX_RULE_STATUS_LABEL[viewing.status]} size="lg" onClose={() => setViewing(null)}>
          <Facts
            columns={3}
            items={[
              { label: "UVT", value: cop(viewing.uvtCOP) },
              ...LIMITS.map((limit) => ({ label: limit.label, value: `${integer(viewing[limit.key])} UVT · ${cop(viewing[limit.key] * viewing.uvtCOP)}` })),
              { label: "Vigente desde", value: day(viewing.effectiveFrom) },
              { label: "Vigente hasta", value: viewing.effectiveTo ? day(viewing.effectiveTo) : "Sin fecha de fin" },
              { label: "Creada", value: date(viewing.createdAt) },
              { label: "Aprobada", value: viewing.approvedAt ? date(viewing.approvedAt) : "—" },
              { label: "Puesta vigente", value: viewing.activatedAt ? date(viewing.activatedAt) : "—" },
              { label: "Fuente documental", value: viewing.sourceDocument, wide: true },
              { label: "Enlace a la fuente", value: viewing.sourceUrl ? <a className="cs-link" href={viewing.sourceUrl} target="_blank" rel="noreferrer noopener">{viewing.sourceUrl}</a> : "—", wide: true },
              { label: "Notas", value: viewing.notes, wide: true },
            ]}
          />
        </Modal>
      )}
      {transition && (
        <ConfirmDialog
          title={transition.action === "approve" ? "Aprobar la regla" : "Poner vigente la regla"}
          confirmLabel={transition.action === "approve" ? "Aprobar" : "Poner vigente"}
          onClose={() => setTransition(null)}
          onConfirm={async () => {
            await send("POST", `/admin/tax-rules/${transition.rule.id}/${transition.action}`);
            notify(transition.action === "approve" ? "Regla aprobada. Ya puede ponerse vigente." : `La regla ${transition.rule.taxYear} v${transition.rule.version} quedó vigente.`);
            await rules.reload();
          }}
        >
          {transition.action === "approve"
            ? <p>Confirmas que los topes de la versión <strong>{transition.rule.version}</strong> del año gravable <strong>{transition.rule.taxYear}</strong> corresponden a la fuente documental citada.</p>
            : <p>Desde ahora el diagnóstico del año gravable <strong>{transition.rule.taxYear}</strong> usará la versión <strong>{transition.rule.version}</strong> (UVT {cop(transition.rule.uvtCOP)}). La versión vigente anterior quedará como sustituida y los casos ya diagnosticados conservan la regla con la que se evaluaron.</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

function RuleForm({ base, onClose, onSaved }: { base: TaxRule | null; onClose: () => void; onSaved: (rule: TaxRule) => Promise<void> }) {
  const [values, setValues] = useState({
    taxYear: String(base?.taxYear ?? new Date().getFullYear() - 1),
    uvtCOP: String(base?.uvtCOP ?? ""),
    wealthUvt: String(base?.wealthUvt ?? ""),
    incomeUvt: String(base?.incomeUvt ?? ""),
    cardSpendUvt: String(base?.cardSpendUvt ?? ""),
    purchasesUvt: String(base?.purchasesUvt ?? ""),
    depositsUvt: String(base?.depositsUvt ?? ""),
    sourceDocument: "",
    sourceUrl: "",
    effectiveFrom: today(),
    effectiveTo: "",
    notes: "",
  });
  const action = useAction();
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const uvt = Number(values.uvtCOP) || 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => {
      const rule = await send<TaxRule>("POST", "/admin/tax-rules", {
        taxYear: Number(values.taxYear), uvtCOP: Number(values.uvtCOP), wealthUvt: Number(values.wealthUvt), incomeUvt: Number(values.incomeUvt), cardSpendUvt: Number(values.cardSpendUvt),
        purchasesUvt: Number(values.purchasesUvt), depositsUvt: Number(values.depositsUvt), sourceDocument: values.sourceDocument.trim(), sourceUrl: values.sourceUrl.trim() || undefined,
        effectiveFrom: values.effectiveFrom, effectiveTo: values.effectiveTo || undefined, notes: values.notes.trim() || undefined,
      });
      await onSaved(rule);
    });
  };
  return (
    <Modal title="Nueva versión de regla tributaria" description={base ? `Parte de los valores del año ${base.taxYear}, versión ${base.version}. Se crea en borrador.` : "Se crea en borrador."} size="lg" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <div className="cs-fields cs-fields-3">
          <Field label="Año gravable" required><input type="number" min={2020} max={2100} value={values.taxYear} onChange={set("taxYear")} required /></Field>
          <Field label="Valor de la UVT (COP)" required hint="La fijada por la DIAN para ese año."><input type="number" min={1000} max={1000000} step={1} value={values.uvtCOP} onChange={set("uvtCOP")} required /></Field>
          <span />
          {LIMITS.map((limit) => (
            <Field key={limit.key} label={`${limit.label} (UVT)`} required hint={uvt && Number(values[limit.key]) ? `Equivale a ${cop(uvt * Number(values[limit.key]))}` : "Tope en UVT."}>
              <input type="number" min={1} max={1000000} step={1} value={values[limit.key]} onChange={set(limit.key)} required />
            </Field>
          ))}
          <span />
          <Field label="Fuente documental" required wide hint="Norma, resolución o concepto que respalda los valores (mínimo 10 caracteres)."><textarea value={values.sourceDocument} onChange={set("sourceDocument")} minLength={10} maxLength={2000} rows={2} required /></Field>
          <Field label="Enlace a la fuente" hint="Opcional."><input type="url" placeholder="https://www.dian.gov.co/…" value={values.sourceUrl} onChange={set("sourceUrl")} maxLength={500} /></Field>
          <Field label="Vigente desde" required><input type="date" value={values.effectiveFrom} onChange={set("effectiveFrom")} required /></Field>
          <Field label="Vigente hasta" hint="Opcional."><input type="date" value={values.effectiveTo} onChange={set("effectiveTo")} /></Field>
          <Field label="Notas" wide><textarea value={values.notes} onChange={set("notes")} maxLength={2000} rows={2} /></Field>
        </div>
        <ErrorBox problem={action.problem} />
        <FormActions busy={action.busy} onCancel={onClose} submitLabel="Crear en borrador" />
      </form>
    </Modal>
  );
}
