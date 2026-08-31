import type { MetadataRoute } from "next";

const origin = "https://luft.restaurar.co";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/registro`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/login`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
