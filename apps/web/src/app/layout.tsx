import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";
import "./luft.css";
import "./luft-desktop.css";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-dm-sans", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "LUFT — Construye tu futuro financiero", template: "%s · LUFT" },
  description: "Diagnóstico, educación y una ruta clara para construir tu historial financiero en Colombia.",
  applicationName: "LUFT",
  alternates: { canonical: "/" },
  keywords: ["educación financiera", "historial crediticio", "jóvenes", "Colombia", "LUFT", "StartIF"],
  authors: [{ name: "LUFT" }],
  creator: "LUFT",
  publisher: "LUFT",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "LUFT" },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "es_CO",
    url: "/",
    siteName: "LUFT",
    title: "LUFT — Construye tu futuro financiero",
    description: "Conoce tu perfil, aprende y construye una ruta financiera clara en Colombia.",
    images: [{ url: "/images/luft-welcome.png", width: 1024, height: 1024, alt: "Bienvenida a LUFT" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LUFT — Construye tu futuro financiero",
    description: "Conoce tu perfil, aprende y construye una ruta financiera clara en Colombia.",
    images: ["/images/luft-welcome.png"],
  },
};

export const viewport: Viewport = { themeColor: "#1342d3", width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={dmSans.variable}>
      <body>
        {children}
        <script defer src="https://restaurar.co/m.js" data-site="luft" data-exclude="/app,/admin,/entidad,/aliado,/invitacion,/login,/verificar,/recuperar,/api" />
      </body>
    </html>
  );
}
