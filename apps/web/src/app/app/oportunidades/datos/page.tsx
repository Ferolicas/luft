"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLuft } from "@/components/luft/shell";
import { Alert, Button, Card, Field, Header, Icon, Screen, Tip } from "@/components/luft/ui";
import { PageState } from "@/components/luft/v2/kit";
import { fmtDateTime, send, todayISO, useAction, useResource } from "@/lib/v2/api";
import type { Declared } from "@/lib/v2/types";

const DEPARTMENTS = ["Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío", "Risaralda", "San Andrés y Providencia", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada"];
const adultLimit = () => { const today = todayISO(); return `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`; };

export default function DeclaredDataPage() {
  const resource = useResource<Declared>("/matching/profile");
  if (!resource.data) return <PageState title="Mis datos para oportunidades" back="/app/oportunidades" failure={resource.failure} onRetry={resource.reload} />;
  return <DeclaredForm initial={resource.data} />;
}

function DeclaredForm({ initial }: { initial: Declared }) {
  const router = useRouter();
  const { notify } = useLuft();
  const [birthDate, setBirthDate] = useState(initial.birthDate ?? "");
  const [department, setDepartment] = useState(initial.department ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [activity, setActivity] = useState(initial.activityStartDate ?? "");
  const action = useAction();
  const options = department && !DEPARTMENTS.includes(department) ? [department, ...DEPARTMENTS] : DEPARTMENTS;
  const underage = Boolean(birthDate) && birthDate > adultLimit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await send<Declared>("PUT", "/matching/profile", { birthDate: birthDate || null, department: department || null, city: city.trim() || null, activityStartDate: activity || null });
      notify("Guardamos tus datos. Vuelve a buscar para actualizar tus resultados.");
      router.push("/app/oportunidades");
    });
  };
  return (
    <Screen>
      <Header back="/app/oportunidades" title="Mis datos para oportunidades" subtitle="Tú los declaras. Solo se usan para comparar tu perfil con las políticas de cada entidad." />
      <form className="l-body" onSubmit={submit}>
        <Card>
          <Field label="Fecha de nacimiento" hint={underage ? "Debes ser mayor de edad." : "Con ella calculamos tu edad."} valid={Boolean(birthDate) && !underage}><input type="date" value={birthDate} max={adultLimit()} onChange={(event) => setBirthDate(event.target.value)} /></Field>
          <Field label="Departamento donde vives" trailing={<Icon name="keyboard_arrow_down" />}><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Selecciona</option>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field label="Ciudad o municipio" valid={city.trim().length >= 2}><input value={city} maxLength={80} autoComplete="address-level2" placeholder="Ej.: Cali" onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label="¿Desde cuándo estás en tu trabajo o actividad actual?" hint="Con ella calculamos tu antigüedad laboral o comercial." valid={Boolean(activity)}><input type="date" value={activity} max={todayISO()} onChange={(event) => setActivity(event.target.value)} /></Field>
          {initial.updatedAt && <span className="l-small">Última actualización: {fmtDateTime(initial.updatedAt)}</span>}
        </Card>
        <Tip icon="lock" title="Se guardan cifrados">Puedes dejar un campo vacío para borrarlo. Solo llegan a una entidad si autorizas expresamente una presentación.</Tip>
        {action.failure && <Alert>{action.failure}</Alert>}
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" disabled={underage || action.busy}>{action.busy ? "Guardando…" : "Guardar mis datos"}</Button></div>
      </form>
    </Screen>
  );
}
