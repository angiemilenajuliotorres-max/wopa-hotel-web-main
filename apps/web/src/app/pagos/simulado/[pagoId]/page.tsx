import { notFound } from "next/navigation";
import { datosPagoSimulado, proveedores } from "@wopa/servicios";
import { dinero } from "@/lib/formato";
import { resolverPagoSimulado } from "./acciones";

export default async function PaginaPagoSimulado({ params }: PageProps<"/pagos/simulado/[pagoId]">) {
  const { pagoId } = await params;
  const pago = await datosPagoSimulado(pagoId);
  if (!pago || !proveedores().get("simulado")?.disponible()) notFound();
  return (
    <div className="tarjeta pila">
      <p className="aviso advertencia">Pasarela de pruebas · no se cobra dinero real</p>
      <h1 style={{ fontSize: "1.4rem" }}>{dinero(pago.monto_centavos, pago.moneda_codigo, pago.idioma)}</h1>
      <p className="suave">Anticipo de la reserva {pago.codigo} · {pago.hotel}</p>
      {pago.estado !== "pendiente" ? (
        <p className="aviso info">Este pago ya fue procesado ({pago.estado}).</p>
      ) : (
        <form action={resolverPagoSimulado} className="fila">
          <input type="hidden" name="pagoId" value={pago.id} />
          <button className="boton" name="resultado" value="aprobar" type="submit">Aprobar pago</button>
          <button className="boton secundario" name="resultado" value="rechazar" type="submit">Rechazar</button>
        </form>
      )}
    </div>
  );
}
