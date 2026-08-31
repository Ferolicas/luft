import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app/", "/admin/", "/api/", "/verificar/"],
    },
    sitemap: "https://luft.restaurar.co/sitemap.xml",
    host: "https://luft.restaurar.co",
  };
}
