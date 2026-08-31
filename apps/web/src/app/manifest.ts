import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LUFT — Tu futuro financiero",
    short_name: "LUFT",
    description: "Construye tu historial financiero paso a paso.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f4f8ff",
    theme_color: "#1354e8",
    lang: "es-CO",
    categories: ["finance", "education"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
