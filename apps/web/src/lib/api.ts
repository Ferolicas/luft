export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: Record<string, unknown>) {
    super(String(body.message ?? "No pudimos completar la solicitud."));
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const response = error.body.response;
    if (response && typeof response === "object" && "message" in response) return String(response.message);
    if (error.body.message) return Array.isArray(error.body.message) ? error.body.message.join(" · ") : String(error.body.message);
  }
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

export function money(value: string | number | bigint | null | undefined) {
  const amount = Math.round(Number(value ?? 0));
  return `${amount < 0 ? "-" : ""}$${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.abs(amount))}`;
}
