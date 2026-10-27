"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Brand } from "./brand";
import { Notice } from "./status";

export function AuthFrame({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link href="/" className="back-link">
          <ArrowLeft size={17} /> Volver
        </Link>
        <Brand />
        <div className="auth-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
      <aside className="auth-art">
        <div className="auth-art-copy">
          <span className="eyebrow eyebrow-light">Tu ruta. A tu ritmo.</span>
          <h2>Construir historial también se aprende.</h2>
          <p>LUFT convierte cada paso en una decisión clara.</p>
        </div>
        <div className="auth-shape">
          <LockKeyhole size={44} />
          <span>
            Información protegida
            <br />
            <strong>de principio a fin</strong>
          </span>
        </div>
      </aside>
    </main>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [identifier, setIdentifier] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: data.get("identifier"),
          password: data.get("password"),
        }),
      });
      router.push("/app");
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function passkey() {
    if (!identifier) return setError("Escribe primero tu usuario o correo.");
    setBusy(true);
    setError("");
    try {
      const first = await api<{
        challengeId: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>("/auth/passkeys/authentication-options", {
        method: "POST",
        body: JSON.stringify({ identifier }),
      });
      const result = await startAuthentication({ optionsJSON: first.options });
      await api("/auth/passkeys/authentication-verification", {
        method: "POST",
        body: JSON.stringify({
          challengeId: first.challengeId,
          response: result,
        }),
      });
      router.push("/app");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      {error && <Notice type="error">{error}</Notice>}
      <label>
        Correo o usuario
        <input
          name="identifier"
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
      </label>
      <label>
        Contraseña
        <div className="password-field">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={19} /> : <Eye size={19} />}
          </button>
        </div>
      </label>
      <div className="form-line">
        <label className="check-line">
          <input type="checkbox" /> <span>Recordarme</span>
        </label>
        <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
      </div>
      <button className="button button-full" disabled={busy}>
        {busy ? (
          "Entrando…"
        ) : (
          <>
            Entrar <ArrowRight size={18} />
          </>
        )}
      </button>
      <button
        className="button button-full button-ghost"
        type="button"
        disabled={busy}
        onClick={passkey}
      >
        <Fingerprint size={20} /> Entrar con llave de acceso
      </button>
      <p className="auth-switch">
        ¿Aún no tienes cuenta? <Link href="/registro">Créala aquí</Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [registrationMode, setRegistrationMode] = useState<
    "closed" | "invite" | "public"
  >("invite");
  useEffect(() => {
    api<{ mode: "closed" | "invite" | "public" }>("/auth/registration-settings")
      .then(({ mode }) => setRegistrationMode(mode))
      .catch(() => undefined);
  }, []);
  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    ) as Record<string, string>;
    setValues((current) => ({ ...current, ...data }));
    setStep(2);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = {
      ...values,
      ...Object.fromEntries(new FormData(event.currentTarget).entries()),
      consentAccepted: true,
      consentVersion: "2026-09-01-restaurar",
    };
    try {
      const result = await api<{
        userId: string;
        verification: {
          challengeId: string;
          delivery: string;
          testCode?: string;
        };
      }>("/auth/register", { method: "POST", body: JSON.stringify(data) });
      sessionStorage.setItem(
        "luft_verification",
        JSON.stringify(result.verification),
      );
      try {
        (window as unknown as { restaurarTrack?: (n: string, m?: Record<string, string>) => void }).restaurarTrack?.("lead", { form: "registro" });
      } catch {
        /* la analítica nunca rompe el formulario */
      }
      router.push(`/verificar?delivery=${result.verification.delivery}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="register-wrap">
      <div className="steps">
        <span className="active">
          <b>1</b> Datos
        </span>
        <i />
        <span className={step === 2 ? "active" : ""}>
          <b>2</b> Seguridad
        </span>
        <i />
        <span>
          <b>3</b> Validación
        </span>
      </div>
      {error && <Notice type="error">{error}</Notice>}
      {registrationMode === "closed" && (
        <Notice type="warning">El registro está temporalmente cerrado.</Notice>
      )}
      {step === 1 ? (
        <form className="auth-form" onSubmit={next}>
          <div className="field-grid">
            <label className="wide">
              Nombre completo
              <input
                name="fullName"
                defaultValue={values.fullName}
                autoComplete="name"
                required
                minLength={3}
              />
            </label>
            <label>
              Cédula
              <input
                name="document"
                defaultValue={values.document}
                inputMode="numeric"
                required
              />
            </label>
            <label>
              Fecha de expedición
              <input
                name="documentIssuedAt"
                defaultValue={values.documentIssuedAt}
                type="date"
                required
              />
            </label>
            <label>
              Celular
              <input
                name="phone"
                defaultValue={values.phone || "+57"}
                inputMode="tel"
                required
                pattern="\+?57[0-9]{10}"
              />
            </label>
            <label>
              Correo
              <input
                name="email"
                defaultValue={values.email}
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label className="wide">
              Dirección de residencia
              <input
                name="address"
                defaultValue={values.address}
                autoComplete="street-address"
                required
                minLength={8}
              />
            </label>
            <label>
              Estrato
              <select
                name="stratum"
                defaultValue={values.stratum || ""}
                required
              >
                <option value="" disabled>
                  Selecciona
                </option>
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="button button-full"
            disabled={registrationMode === "closed"}
          >
            Continuar <ArrowRight size={18} />
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label>
            Nombre de usuario
            <input
              name="username"
              autoComplete="username"
              required
              minLength={4}
              pattern="[a-zA-Z0-9._-]+"
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <ul className="password-rules">
            <li>
              <Check size={15} /> Mínimo 12 caracteres
            </li>
            <li>
              <Check size={15} /> Una mayúscula, una minúscula y un número
            </li>
          </ul>
          {registrationMode === "invite" && (
            <label>
              Código de acceso para pruebas
              <input
                name="inviteCode"
                type="password"
                autoComplete="off"
                required
                minLength={16}
              />
              <small>Solicítalo al responsable del piloto de LUFT.</small>
            </label>
          )}
          <label className="consent-check">
            <input type="checkbox" required />
            <span>
              Autorizo a Tureporte S.A.S., propietaria de RESTAURAR, el{" "}
              <Link href="/legal/privacidad" target="_blank">
                tratamiento de mis datos personales
              </Link>
              . Las consultas ante centrales y el crédito tendrán autorizaciones
              separadas.
            </span>
          </label>
          <div className="form-buttons">
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setStep(1)}
            >
              Atrás
            </button>
            <button className="button" disabled={busy}>
              {busy ? "Creando…" : "Crear mi cuenta"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function VerifyForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testCode, setTestCode] = useState("");
  useEffect(() => {
    const stored = sessionStorage.getItem("luft_verification");
    if (!stored) return;
    const verification = JSON.parse(stored) as { testCode?: string };
    setTestCode(verification.testCode ?? "");
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stored = sessionStorage.getItem("luft_verification");
    if (!stored)
      return setError("Vuelve al registro para solicitar un código nuevo.");
    const { challengeId } = JSON.parse(stored) as { challengeId: string };
    setBusy(true);
    try {
      const data = new FormData(event.currentTarget);
      await api("/auth/verify-phone", {
        method: "POST",
        body: JSON.stringify({ challengeId, code: data.get("code") }),
      });
      sessionStorage.removeItem("luft_verification");
      router.push("/app/diagnostico");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="auth-form verify-form" onSubmit={submit}>
      {error && <Notice type="error">{error}</Notice>}
      {testCode && (
        <Notice type="info">
          Código temporal del piloto: <strong>{testCode}</strong>. Cuando se
          conecte el proveedor SMS dejará de mostrarse aquí.
        </Notice>
      )}
      <label>
        Código de 6 dígitos
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          defaultValue={testCode}
          required
          autoFocus
        />
      </label>
      <button className="button button-full" disabled={busy}>
        {busy ? "Verificando…" : "Verificar y continuar"}
      </button>
      <p className="auth-switch">
        ¿No llegó? Durante el piloto el código aparece arriba; luego llegará por
        SMS.
      </p>
    </form>
  );
}
