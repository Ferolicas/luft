import { redirect } from "next/navigation";

/**
 * La preparación de la declaración vive ahora en el asistente de formalización
 * (diagnóstico, carga o preparación guiada, revisión profesional y evidencia).
 * Esta ruta se conserva para los enlaces y notificaciones anteriores.
 */
export default function TaxReturnPage() {
  redirect("/app/formalizacion");
}
