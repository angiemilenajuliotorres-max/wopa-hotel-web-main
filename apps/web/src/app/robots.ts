import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.URL_PUBLICA ?? "http://localhost:3100";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/extranet", "/acceso", "/api", "/es/reservar", "/en/reservar", "/es/buscar", "/en/buscar"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
