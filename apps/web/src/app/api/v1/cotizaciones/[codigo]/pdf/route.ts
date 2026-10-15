import PDFDocument from "pdfkit";
import { obtenerCotizacion } from "@wopa/servicios";
import { dinero } from "@/lib/formato";

/** PDF de la cotización (el código aleatorio de 16 hex es la credencial, como en la web heredada). */
export async function GET(_request: Request, { params }: RouteContext<"/api/v1/cotizaciones/[codigo]/pdf">) {
  const cotizacion = await obtenerCotizacion((await params).codigo.toUpperCase());
  if (!cotizacion) return Response.json({ error: { code: "COTIZACION_NO_ENCONTRADA" } }, { status: 404 });
  const es = cotizacion.idioma === "es";

  const documento = new PDFDocument({ size: "A4", margin: 54, info: { Title: `WOPA Travel ${cotizacion.codigo}`, Author: "WOPA Travel" } });
  const partes: Buffer[] = [];
  documento.on("data", (parte: Buffer) => partes.push(parte));
  const terminado = new Promise<Buffer>((resolver) => documento.on("end", () => resolver(Buffer.concat(partes))));

  documento.fillColor("#1b2f6b").fontSize(22).font("Helvetica-Bold").text("WOPA Travel");
  documento.moveDown(0.3).fillColor("#5f6b7a").fontSize(10).font("Helvetica")
    .text(`${es ? "Cotización" : "Quote"} ${cotizacion.codigo} · ${new Date(cotizacion.creado_en).toLocaleDateString(es ? "es-PA" : "en-US")}`);
  documento.moveDown(1).fillColor("#1b1f2a").fontSize(12).text(`${es ? "Para" : "For"}: ${cotizacion.nombre}`);
  documento.text(`${es ? "Personas" : "Guests"}: ${cotizacion.personas}`);
  if (cotizacion.fecha_entrada && cotizacion.fecha_salida) documento.text(`${es ? "Fechas" : "Dates"}: ${cotizacion.fecha_entrada} → ${cotizacion.fecha_salida}`);
  documento.moveDown(1);

  for (const linea of cotizacion.lineas) {
    const monto = linea.monto_centavos === null ? (es ? "A confirmar" : "To be confirmed") : dinero(linea.monto_centavos, "USD", cotizacion.idioma);
    const y = documento.y;
    documento.fontSize(11).fillColor("#1b1f2a").text(linea.descripcion, 54, y, { width: 360 });
    documento.text(monto, 420, y, { width: 120, align: "right" });
    documento.moveDown(0.6);
  }
  documento.moveDown(0.5).moveTo(54, documento.y).lineTo(540, documento.y).strokeColor("#dde4f0").stroke().moveDown(0.5);
  documento.font("Helvetica-Bold").fontSize(13).fillColor("#1b2f6b")
    .text(`${es ? "Total estimado" : "Estimated total"}: ${dinero(cotizacion.totalCentavos, "USD", cotizacion.idioma)}${cotizacion.parcial ? (es ? " (parcial)" : " (partial)") : ""}`, { align: "right" });
  documento.moveDown(1.5).font("Helvetica").fontSize(9).fillColor("#5f6b7a").text(
    es
      ? "Estimado sin compromiso. La disponibilidad, el operador del tour y el precio final se confirman al reservar. Al reservar hospedaje pagas un anticipo en línea y el resto en el hotel."
      : "Non-binding estimate. Availability, tour operator and final price are confirmed when booking. When booking a hotel you pay a deposit online and the rest at the hotel.",
  );
  documento.end();

  const pdf = await terminado;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="wopa-${cotizacion.codigo.toLowerCase()}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
