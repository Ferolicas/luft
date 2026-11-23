/**
 * Dirección pública del sitio. Sale de la configuración del servidor
 * (`APP_URL`), así que cambiar de dominio no requiere tocar el código.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? "https://luft.com.co").replace(/\/+$/, "");
