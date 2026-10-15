import { listarHotelesAdmin, resumenPagosAdmin } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { dinero, hoyMas } from "@/lib/formato";
import { exigirWopa } from "@/lib/sesion";
import { aprobarLiquidacionAccion, completarReembolsoAccion, generarLiquidacionAccion, pagarLiquidacionAccion } from "../acciones";

const CUENTAS: Record<string, string> = {
  caja_proveedor: "Caja en pasarelas",
  por_pagar_hotel: "Por pagar a hoteles",
  ingreso_margen: "Ingreso por margen",
  ingreso_penalizacion: "Ingreso por penalizaciones",
  comision_pasarela: "Comisiones de pasarela",
  reembolso_cliente: "Reembolsos",
  gasto_operativo: "Gastos operativos",
  ingreso_otro: "Otros ingresos",
};
const ESTADOS_PAGO: Record<string, string> = {
  pendiente: "Pendiente", autorizado: "Autorizado", capturado: "Cobrado", fallido: "Fallido", cancelado: "Cancelado", reembolsado_parcial: "Reembolso parcial", reembolsado: "Reembolsado",
};

export default async function PaginaPagos({ searchParams }: PageProps<"/admin/pagos">) {
  const sesion = await exigirWopa();
  const { error, ok } = await searchParams;
  const [{ pagos, saldos, liquidaciones, reembolsosPendientes }, hoteles] = await Promise.all([resumenPagosAdmin(sesion), listarHotelesAdmin(sesion)]);
  const mensaje = mensajeDeError(error);

  return (
    <div className="pila">
      <h1>Pagos y liquidaciones</h1>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Cambios guardados.</p>}

      {reembolsosPendientes.length > 0 && (
        <section className="tarjeta pila" aria-labelledby="titulo-reembolsos">
          <h2 id="titulo-reembolsos">Reembolsos manuales pendientes</h2>
          <p className="chico suave">El proveedor no permite reembolsar desde la plataforma: hazlo en su portal y registra la referencia.</p>
          {reembolsosPendientes.map((r) => (
            <form key={r.id} action={completarReembolsoAccion} className="fila">
              <input type="hidden" name="reembolsoId" value={r.id} />
              <span className="cifra">{r.codigo} · {r.proveedor_codigo} · {dinero(r.monto_centavos, "USD", "es")}</span>
              <div className="campo"><label htmlFor={`ref-${r.id}`} className="solo-lectores">Referencia</label><input id={`ref-${r.id}`} name="referencia" placeholder="Referencia del reembolso" required /></div>
              <button className="boton" type="submit">Registrar reembolso hecho</button>
            </form>
          ))}
        </section>
      )}

      <section className="tarjeta pila" aria-labelledby="titulo-saldos">
        <h2 id="titulo-saldos">Saldos contables</h2>
        <p className="chico suave">Débitos positivos, créditos negativos. El libro siempre suma cero por moneda.</p>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Cuenta</th><th>Moneda</th><th>Saldo</th></tr></thead>
            <tbody>
              {saldos.length === 0 && <tr><td colSpan={3} className="suave">Sin movimientos todavía.</td></tr>}
              {saldos.map((s) => <tr key={`${s.cuenta}-${s.moneda_codigo}`}><td>{CUENTAS[s.cuenta] ?? s.cuenta}</td><td>{s.moneda_codigo}</td><td className="cifra">{dinero(s.saldo, s.moneda_codigo, "es")}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta pila" aria-labelledby="titulo-liquidaciones">
        <h2 id="titulo-liquidaciones">Liquidaciones a hoteles</h2>
        <form action={generarLiquidacionAccion} className="rejilla-3" style={{ alignItems: "end" }}>
          <div className="campo">
            <label htmlFor="hotelId">Hotel</label>
            <select id="hotelId" name="hotelId">{hoteles.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}</select>
          </div>
          <div className="campo"><label htmlFor="desde">Salidas desde</label><input id="desde" name="desde" type="date" required defaultValue={hoyMas(-15)} /></div>
          <div className="campo"><label htmlFor="hasta">Hasta</label><input id="hasta" name="hasta" type="date" required defaultValue={hoyMas(0)} /></div>
          <button className="boton" type="submit">Generar liquidación</button>
        </form>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Hotel</th><th>Periodo</th><th>Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {liquidaciones.length === 0 && <tr><td colSpan={5} className="suave">Aún no hay liquidaciones.</td></tr>}
              {liquidaciones.map((l) => (
                <tr key={l.id}>
                  <td>{l.hotel}</td>
                  <td className="cifra">{l.periodo_desde} → {l.periodo_hasta}</td>
                  <td className="cifra">{dinero(l.total, l.moneda_codigo, "es")}</td>
                  <td>{l.estado}{l.referencia_transferencia ? ` · ${l.referencia_transferencia}` : ""}</td>
                  <td>
                    {l.estado === "borrador" && <form action={aprobarLiquidacionAccion}><input type="hidden" name="liquidacionId" value={l.id} /><button className="boton secundario" type="submit">Aprobar</button></form>}
                    {l.estado === "aprobada" && (
                      <form action={pagarLiquidacionAccion} className="fila">
                        <input type="hidden" name="liquidacionId" value={l.id} />
                        <label htmlFor={`trf-${l.id}`} className="solo-lectores">Referencia de la transferencia</label>
                        <input id={`trf-${l.id}`} name="referencia" placeholder="Referencia de la transferencia" required />
                        <button className="boton" type="submit">Marcar pagada</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pila" aria-labelledby="titulo-cobros">
        <h2 id="titulo-cobros">Últimos cobros</h2>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Fecha</th><th>Reserva</th><th>Hotel</th><th>Proveedor</th><th>Monto</th><th>Estado</th></tr></thead>
            <tbody>
              {pagos.length === 0 && <tr><td colSpan={6} className="suave">Aún no hay cobros.</td></tr>}
              {pagos.map((p) => (
                <tr key={p.id}>
                  <td className="cifra">{new Date(p.creado_en).toLocaleString("es-PA", { timeZone: "America/Panama", dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="cifra">{p.codigo}</td>
                  <td>{p.hotel}</td>
                  <td>{p.proveedor_codigo} · {p.metodo}</td>
                  <td className="cifra">{dinero(p.monto_centavos, p.moneda_codigo, "es")}</td>
                  <td>{ESTADOS_PAGO[p.estado] ?? p.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
