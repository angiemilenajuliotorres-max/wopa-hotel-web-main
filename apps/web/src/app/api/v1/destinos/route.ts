import { buscarDestinos } from "@wopa/servicios";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const texto = (url.searchParams.get("q") ?? "").slice(0, 80);
  const idioma = url.searchParams.get("idioma") === "en" ? "en" : "es";
  const destinos = await buscarDestinos(texto, idioma);
  return Response.json({ destinos }, { headers: { "cache-control": "public, max-age=60" } });
}
