import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://luft.restaurar.co"),
  title: { default: "LUFT — Construye tu futuro financiero", template: "%s · LUFT" },
  description: "Diagnóstico, educación y una ruta clara para construir tu historial financiero en Colombia.",
  applicationName: "LUFT",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LUFT" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#1354e8", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
