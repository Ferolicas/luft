import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LUFT — Tu futuro financiero",
    short_name: "LUFT",
    description: "Construye tu historial financiero paso a paso.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1342d3",
    lang: "es-CO",
    categories: ["finance", "education"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
