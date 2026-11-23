import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const origin = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/empezar`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${origin}/registro`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/login`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
