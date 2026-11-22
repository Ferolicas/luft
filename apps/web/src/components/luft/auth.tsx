"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { rememberBureauConsent, syncAfterSignup } from "@/lib/journey";
import { Alert, Button, Card, Checkbox, ColombiaFlag, Field, Header, Icon, Luft, Screen, Tip } from "./ui";

type Passkey = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); router.push("/app"); router.refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); void run(async () => { await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }); }); };
  const passkey = () => {
    if (!identifier) return setError("Escribe primero tu usuario o correo.");
    void run(async () => {
      const first = await api<{ challengeId: string; options: Passkey }>("/auth/passkeys/authentication-options", { method: "POST", body: JSON.stringify({ identifier }) });
      const response = await startAuthentication({ optionsJSON: first.options });
      await api("/auth/passkeys/authentication-verification", { method: "POST", body: JSON.stringify({ challengeId: first.challengeId, response }) });
    });
  };
  return (
    <Screen>
      <Header back="/" title="Qué bueno verte de nuevo" subtitle="Continúa construyendo tu historial." />
      <form className="l-body" onSubmit={submit}>
        <Card>
          {error && <Alert>{error}</Alert>}
          <Field label="Correo o usuario"><input name="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></Field>
          <Field label="Contraseña" trailing={<button type="button" onClick={() => setShow(!show)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}><Icon name="visibility" /></button>}>
            <input name="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          <Link href="/recuperar" className="l-link" style={{ fontSize: 14, justifySelf: "end" }}>¿Olvidaste tu contraseña?</Link>
        </Card>
        <Tip lufty title="Entra sin contraseña">Si registraste una llave de acceso, usa tu huella, rostro o PIN.</Tip>
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}>
          <Button type="submit" arrow disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
          <Button variant="secondary" icon="lock" onClick={passkey} disabled={busy}>Usar llave de acceso</Button>
          <small>¿Aún no tienes cuenta? <Link className="l-link" href="/empezar">Empieza aquí</Link></small>
        </div>
      </form>
    </Screen>
  );
}

/** The four checks the API enforces; the strength meter counts them one by one. */
const CHECKS = [(value: string) => value.length >= 12, (value: string) => /\d/.test(value), (value: string) => /[A-Z]/.test(value), (value: string) => /[a-z]/.test(value)];
/** What the person reads: three requirements that always fit on one line. */
const RULES = [
  { label: "12+ caracteres", test: CHECKS[0] },
  { label: "Un número", test: CHECKS[1] },
  { label: "Mayúscula y minúscula", test: (value: string) => CHECKS[2](value) && CHECKS[3](value) },
];
const STRENGTH = ["Muy débil", "Débil", "Aceptable", "Casi", "Segura"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function RegisterScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"closed" | "invite" | "public">("invite");
  const [show, setShow] = useState(false);
  const [terms, setTerms] = useState(false);
  const [bureau, setBureau] = useState(false);
  const [form, setForm] = useState({ fullName: "", document: "", documentIssuedAt: "", phone: "", email: "", address: "", stratum: "", username: "", password: "", inviteCode: "" });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  useEffect(() => { api<{ mode: "closed" | "invite" | "public" }>("/auth/registration-settings").then((result) => setMode(result.mode)).catch(() => undefined); }, []);
  const passed = CHECKS.filter((test) => test(form.password)).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 3) return setStep(step + 1);
    if (passed < CHECKS.length) return setError("Tu contraseña aún no cumple todos los requisitos.");
    setBusy(true); setError("");
    try {
      const result = await api<{ verification: { challengeId: string; delivery: string; testCode?: string } }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ ...form, document: form.document.replace(/\D/g, ""), phone: `+57${form.phone.replace(/\D/g, "")}`, inviteCode: form.inviteCode || undefined, consentAccepted: true, consentVersion: "2026-09-01-restaurar" }),
      });
      sessionStorage.setItem("luft_verification", JSON.stringify(result.verification));
      rememberBureauConsent(bureau);
      try { (window as unknown as { restaurarTrack?: (name: string, meta?: Record<string, string>) => void }).restaurarTrack?.("lead", { form: "registro" }); } catch { /* la analítica nunca rompe el formulario */ }
      router.push(`/verificar?delivery=${result.verification.delivery}`);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  const heads: Array<[React.ReactNode, React.ReactNode]> = [
    [<>Comencemos <br className="l-br-m" />por conocerte</>, <>Usa tu nombre tal como <br className="l-br-m" />aparece en tu documento.</>],
    ["¿Cómo te contactamos?", "Ingresa tu celular y tu correo para mantenernos en contacto contigo."],
    ["Protege tu cuenta", <>Crea una contraseña segura <br className="l-br-m" />y revisa las autorizaciones.</>],
  ];
  const head = heads[step - 1];
  return (
    <Screen>
      <Header back onBack={() => (step === 1 ? router.push("/empezar") : setStep(step - 1))} progress={(step / 3) * 100} step={`Paso ${step} de 3`} title={head[0]} subtitle={head[1]} />
      <form className="l-body" onSubmit={submit}>
        {mode === "closed" && <Alert type="warning">El registro está temporalmente cerrado.</Alert>}
        {step === 1 && <>
          <Card>
            <Field label="Nombre completo" valid={form.fullName.trim().length >= 3}><input name="fullName" autoComplete="name" value={form.fullName} onChange={set("fullName")} minLength={3} maxLength={160} required /></Field>
            <Field label="Cédula de ciudadanía" hint="Solo números, sin puntos." valid={/^\d{6,12}$/.test(form.document.replace(/\D/g, ""))}><input name="document" inputMode="numeric" value={form.document} onChange={set("document")} pattern="[0-9. ]{6,15}" required /></Field>
            <Field label="Fecha de expedición" valid={Boolean(form.documentIssuedAt)}><input name="documentIssuedAt" type="date" max={new Date().toISOString().slice(0, 10)} value={form.documentIssuedAt} onChange={set("documentIssuedAt")} required /></Field>
          </Card>
          <Tip lufty title="Hola, soy Lufty">Te acompaño en estos 3 pasos. Tus datos viajan cifrados y protegidos.</Tip>
        </>}
        {step === 2 && <>
          <Card>
            <Field label="Número de celular" prefix={<><ColombiaFlag />+57</>} hint={<span className="l-sr">Número colombiano de 10 dígitos. El prefijo +57 ya está incluido.</span>} valid={/^\d{10}$/.test(form.phone.replace(/\D/g, ""))}><input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="300 123 4567" value={form.phone} onChange={set("phone")} pattern="[0-9 ]{10,13}" required /></Field>
            <Field label="Correo electrónico" valid={EMAIL.test(form.email)}><input name="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required /></Field>
            <Field label="Dirección de residencia" valid={form.address.trim().length >= 8}><input name="address" autoComplete="street-address" value={form.address} onChange={set("address")} minLength={8} maxLength={300} required /></Field>
            <Field label="Estrato socioeconómico" valid={Boolean(form.stratum)} trailing={<Icon name="keyboard_arrow_down" />}>
              <select name="stratum" value={form.stratum} onChange={set("stratum")} required><option value="" disabled>Selecciona</option>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>Estrato {value}</option>)}</select>
            </Field>
          </Card>
          <Tip lufty title="Privacidad">Nunca compartiremos tu número ni tu correo con terceros.</Tip>
        </>}
        {step === 3 && <>
          <Card>
            <Field label="Usuario" hint="De 4 a 40 caracteres: letras, números, punto o guion." valid={/^[a-z0-9._-]{4,40}$/.test(form.username)}><input name="username" autoComplete="username" autoCapitalize="none" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))} pattern="[a-z0-9._\-]{4,40}" required /></Field>
            <Field label="Contraseña" trailing={<button type="button" onClick={() => setShow(!show)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}><Icon name="visibility" /></button>}>
              <input name="password" type={show ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={set("password")} minLength={12} maxLength={128} required />
            </Field>
            <div className="l-strength" aria-live="polite">{CHECKS.map((_, index) => <i key={index} className={index < passed ? "on" : ""} />)}<span>{form.password ? STRENGTH[passed] : ""}</span></div>
            <div className="l-rules-box"><div className="l-rules">{RULES.map((rule) => <span key={rule.label} className={rule.test(form.password) ? "ok" : ""}><Icon name="check" size={14} />{rule.label}</span>)}</div></div>
            {mode === "invite" && <Field label="Código de acceso para pruebas" hint="Durante el piloto el registro es por invitación."><input name="inviteCode" autoComplete="off" value={form.inviteCode} onChange={set("inviteCode")} required /></Field>}
            <hr className="l-divider" />
            <Checkbox checked={terms} onChange={setTerms} required>Acepto los <Link className="l-link" href="/legal/terminos" target="_blank">Términos y Condiciones</Link> y autorizo a Tureporte S.A.S., responsable de LUFT, el tratamiento de mis datos según su <a className="l-link" href="https://restaurar.co/privacy" target="_blank" rel="noreferrer">Política de tratamiento de datos</a>.</Checkbox>
            <Checkbox checked={bureau} onChange={setBureau}>Autorizo la consulta de mi historial en Datacrédito y TransUnion para conocer mi punto de partida. <em>Opcional.</em></Checkbox>
          </Card>
          <Tip lufty title="Sin impacto en tu puntaje">Consultar tu historial con <Luft /> no tiene costo ni baja tu puntaje.</Tip>
        </>}
        {error && <Alert>{error}</Alert>}
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}>
          <Button type="submit" arrow disabled={busy || mode === "closed" || (step === 3 && !terms)}>{step === 1 ? "Continuar" : step === 2 ? "Continuar" : busy ? "Creando tu cuenta…" : "Crear mi cuenta"}</Button>
          <small>{step === 2 ? "Puedes cambiar estos datos después" : <>¿Ya tienes cuenta? <Link className="l-link" href="/login">Inicia sesión</Link></>}</small>
        </div>
      </form>
    </Screen>
  );
}

export function VerifyScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [testCode, setTestCode] = useState("");
  useEffect(() => {
    const stored = sessionStorage.getItem("luft_verification");
    if (!stored) return;
    const verification = JSON.parse(stored) as { testCode?: string };
    setTestCode(verification.testCode ?? ""); setCode(verification.testCode ?? "");
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const stored = sessionStorage.getItem("luft_verification");
    if (!stored) return setError("Vuelve al registro para solicitar un código nuevo.");
    const { challengeId } = JSON.parse(stored) as { challengeId: string };
    setBusy(true); setError("");
    try {
      await api("/auth/verify-phone", { method: "POST", body: JSON.stringify({ challengeId, code }) });
      sessionStorage.removeItem("luft_verification");
      await syncAfterSignup();
      router.push("/app/puntaje");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Header back="/registro" title="Confirma que eres tú" subtitle="Enviamos un código de seis dígitos al celular que registraste." />
      <form className="l-body" onSubmit={submit}>
        <Card>
          {error && <Alert>{error}</Alert>}
          {testCode && <Alert type="info">Código temporal del piloto: <strong>{testCode}</strong>. Cuando se conecte el proveedor SMS dejará de mostrarse aquí.</Alert>}
          <Field label="Código de 6 dígitos" valid={/^\d{6}$/.test(code)}><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus /></Field>
        </Card>
        <Tip lufty title="¿No llegó?">Durante el piloto el código aparece arriba; luego llegará por SMS.</Tip>
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" arrow disabled={busy}>{busy ? "Verificando…" : "Verificar y continuar"}</Button></div>
      </form>
    </Screen>
  );
}

export function RecoveryScreen() {
  const router = useRouter();
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState("");
  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { const result = await api<{ challengeId: string; delivery: string }>("/auth/password-reset/request", { method: "POST", body: JSON.stringify({ identifier: form.get("identifier") }) }); setChallengeId(result.challengeId); setDelivery(result.delivery); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { await api("/auth/password-reset/verify", { method: "POST", body: JSON.stringify({ challengeId, code: form.get("code"), password: form.get("password") }) }); router.push("/login"); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Header back="/login" title="Recupera tu acceso" subtitle="Validaremos tu celular antes de aceptar una contraseña nueva." />
      <form className="l-body" onSubmit={challengeId ? reset : request} key={challengeId ? "reset" : "request"}>
        <Card>
          {error && <Alert>{error}</Alert>}
          {delivery === "configuration_required" && <Alert type="warning">El proveedor SMS está pendiente de credenciales; la solicitud quedó registrada pero no podemos entregar el código todavía.</Alert>}
          {!challengeId ? <Field label="Correo o usuario"><input name="identifier" autoComplete="username" required /></Field> : <>
            <Field label="Código de 6 dígitos"><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></Field>
            <Field label="Contraseña nueva" hint="Mínimo 12 caracteres, con mayúscula, minúscula y número."><input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
          </>}
        </Card>
        <div className="l-footer" style={{ margin: "auto -16px -24px" }}><Button type="submit" arrow disabled={busy}>{!challengeId ? (busy ? "Solicitando…" : "Enviar código") : busy ? "Actualizando…" : "Cambiar contraseña"}</Button></div>
      </form>
    </Screen>
  );
}
