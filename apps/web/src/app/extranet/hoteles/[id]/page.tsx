import Link from "next/link";
import { notFound } from "next/navigation";
import { calendarioHabitacion, detalleHotelAdmin, hotelesDeSesion, liquidacionesDeHotel, listarReservasAdmin } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { dinero, fechaCorta, hoyMas } from "@/lib/formato";
import { exigirSesion } from "@/lib/sesion";
import { cuposExtranet, descripcionExtranet, saldoCobradoExtranet, solicitudExtranet, tarifaExtranet, ticketExtranet } from "../../acciones";

const ESTADOS: Record<string, string> = {
  retenida: "Retenida", pendiente_pago: "Pendiente de pago", solicitada: "Solicitud", confirmada: "Confirmada", rechazada: "Rechazada",
  expirada: "Expirada", cancelada: "Cancelada", completada: "Completada", no_show: "No se presentó",
};

export default async function PaginaHotelExtranet({ params, searchParams }: PageProps<"/extranet/hoteles/[id]">) {
  const sesion = await exigirSesion();
  const { id } = await params;
  const parametros = await searchParams;
  const propios = await hotelesDeSesion(sesion);
  if (!propios.some((h) => h.id === id)) notFound();
  const hotel = await detalleHotelAdmin(sesion, id);
  if (!hotel) notFound();

  const habitacionId = typeof parametros.habitacion === "string" ? parametros.habitacion : hotel.habitaciones[0]?.id;
  const desde = typeof parametros.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parametros.desde) ? parametros.desde : hoyMas(0);
  const [calendario, reservas, liquidaciones] = await Promise.all([
    habitacionId ? calendarioHabitacion(sesion, { hotelId: id, tipoHabitacionId: habitacionId, desde, dias: 21 }) : Promise.resolve([]),
    listarReservasAdmin(sesion),
    liquidacionesDeHotel(sesion, id),
  ]);
  const delHotel = reservas.filter((r) => r.hotel === hotel.nombre).slice(0, 50);
  const mensaje = mensajeDeError(parametros.error);
  const esAdminHotel = sesion.membresias.some((m) => m.organizacionId === hotel.organizacion_id && m.rol === "hotel_admin");

  return (
    <div className="pila">
      <div>
        <p className="chico"><Link href="/extranet">← Mis hoteles</Link></p>
        <h1>{hotel.nombre}</h1>
        <p className="suave">{hotel.ciudad} · tarifas netas en {hotel.moneda} · {hotel.modo_reserva === "solicitud" ? "Bajo solicitud" : "Anticipo en línea"}</p>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {parametros.ok && <p className="aviso exito" role="status">Cambios guardados.</p>}

      <section className="tarjeta pila" aria-labelledby="titulo-calendario">
        <h2 id="titulo-calendario">Calendario de tarifa neta y cupos</h2>
        <p className="chico suave">La tarifa neta es lo que recibe tu hotel. El precio al público lo calcula WOPA.</p>
        <form className="fila" method="get">
          <div className="campo">
            <label htmlFor="habitacion">Habitación</label>
            <select id="habitacion" name="habitacion" defaultValue={habitacionId}>{hotel.habitaciones.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}</select>
          </div>
          <div className="campo"><label htmlFor="desde-cal">Desde</label><input id="desde-cal" name="desde" type="date" defaultValue={desde} /></div>
          <button className="boton secundario" type="submit" style={{ alignSelf: "end" }}>Ver</button>
        </form>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Día</th><th>Neta por ocupación</th><th>Cupo</th><th>Vendidas</th><th>Venta</th></tr></thead>
            <tbody>
              {calendario.map((dia) => (
                <tr key={dia.fecha}>
                  <td className="cifra">{fechaCorta(dia.fecha, "es")}</td>
                  <td className="cifra">{dia.netos ? Object.entries(dia.netos).map(([ocupacion, neto]) => `${ocupacion} p: ${dinero(neto, hotel.moneda, "es")}`).join(" · ") : <span className="suave">Sin tarifa</span>}</td>
                  <td className="cifra">{dia.cupo_total ?? "—"}</td>
                  <td className="cifra">{dia.cupo_vendido ?? 0}</td>
                  <td>{dia.esta_cerrado ? <span className="etiqueta-estado e-cancelada">Cerrada</span> : dia.cupo_total && dia.cupo_total > (dia.cupo_vendido ?? 0) ? <span className="etiqueta-estado e-publicado">Abierta</span> : <span className="suave">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rejilla-2">
          {esAdminHotel && (
            <form action={tarifaExtranet} className="pila">
              <h3>Cambiar tarifa neta por rango</h3>
              <input type="hidden" name="hotelId" value={id} />
              <input type="hidden" name="tipoHabitacionId" value={habitacionId} />
              <div className="campo"><label htmlFor="plan">Plan</label><select id="plan" name="planTarifaId">{hotel.planes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
              <div className="rejilla-2">
                <div className="campo"><label htmlFor="t-desde">Desde</label><input id="t-desde" name="desde" type="date" required defaultValue={desde} /></div>
                <div className="campo"><label htmlFor="t-hasta">Hasta</label><input id="t-hasta" name="hasta" type="date" required /></div>
                <div className="campo"><label htmlFor="ocupacion">Personas</label><input id="ocupacion" name="ocupacion" type="number" min={1} max={12} defaultValue={2} required /></div>
                <div className="campo"><label htmlFor="neto">Neta por noche</label><input id="neto" name="neto" inputMode="decimal" required /></div>
              </div>
              <div><button className="boton" type="submit">Guardar tarifa</button></div>
              <p className="chico suave">Los cambios grandes de precio (más del 40 %) los revisa WOPA.</p>
            </form>
          )}
          <form action={cuposExtranet} className="pila">
            <h3>Cupos o cierre por rango</h3>
            <input type="hidden" name="hotelId" value={id} />
            <input type="hidden" name="tipoHabitacionId" value={habitacionId} />
            <div className="rejilla-2">
              <div className="campo"><label htmlFor="c-desde">Desde</label><input id="c-desde" name="desde" type="date" required defaultValue={desde} /></div>
              <div className="campo"><label htmlFor="c-hasta">Hasta</label><input id="c-hasta" name="hasta" type="date" required /></div>
              <div className="campo"><label htmlFor="cupoTotal">Habitaciones a la venta</label><input id="cupoTotal" name="cupoTotal" type="number" min={0} max={500} /></div>
            </div>
            <label className="fila chico"><input type="checkbox" name="cerrado" /> Cerrar la venta en esas fechas</label>
            <div><button className="boton" type="submit">Guardar cupos</button></div>
          </form>
        </div>
      </section>

      <section className="tarjeta pila" aria-labelledby="titulo-reservas">
        <h2 id="titulo-reservas">Reservas</h2>
        <div className="tabla-contenedor">
          <table>
            <thead><tr><th>Código</th><th>Fechas</th><th>Huésped</th><th>Cobrar en el hotel</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {delHotel.length === 0 && <tr><td colSpan={6} className="suave">Sin reservas todavía.</td></tr>}
              {delHotel.map((r) => (
                <tr key={r.id}>
                  <td className="cifra">{r.codigo}</td>
                  <td className="cifra">{r.fecha_entrada} → {r.fecha_salida}</td>
                  <td>{r.titular_nombre}<br /><span className="chico suave">{r.titular_telefono}</span></td>
                  <td className="cifra">{dinero(BigInt(r.total) - BigInt(r.anticipo), r.moneda, "es")}</td>
                  <td><span className={`etiqueta-estado e-${r.estado}`}>{ESTADOS[r.estado] ?? r.estado}</span></td>
                  <td>
                    {r.estado === "solicitada" && (
                      <form action={solicitudExtranet} className="fila">
                        <input type="hidden" name="hotelId" value={id} />
                        <input type="hidden" name="reservaId" value={r.id} />
                        <button className="boton" name="accion" value="aceptar" type="submit">Hay disponibilidad</button>
                        <button className="boton secundario" name="accion" value="rechazar" type="submit">No hay</button>
                      </form>
                    )}
                    {r.estado === "confirmada" && (
                      <form action={saldoCobradoExtranet}>
                        <input type="hidden" name="hotelId" value={id} />
                        <input type="hidden" name="reservaId" value={r.id} />
                        <button className="boton secundario" type="submit">Saldo cobrado</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rejilla-2" style={{ alignItems: "start" }}>
        {esAdminHotel && (
          <section className="tarjeta pila" aria-labelledby="titulo-descripcion">
            <h2 id="titulo-descripcion">Descripción del hotel</h2>
            <p className="chico suave">WOPA revisa los cambios antes de publicarlos.</p>
            <form action={descripcionExtranet} className="pila">
              <input type="hidden" name="hotelId" value={id} />
              <div className="campo"><label htmlFor="idioma">Idioma</label><select id="idioma" name="idioma"><option value="es">Español</option><option value="en">Inglés</option></select></div>
              <div className="campo"><label htmlFor="descripcion">Descripción</label><textarea id="descripcion" name="descripcion" required minLength={20} rows={6} /></div>
              <div className="campo"><label htmlFor="comoLlegar">Cómo llegar (opcional)</label><textarea id="comoLlegar" name="comoLlegar" /></div>
              <div><button className="boton" type="submit">Enviar a revisión</button></div>
            </form>
          </section>
        )}
        <section className="pila">
          <div className="tarjeta pila">
            <h2>Liquidaciones</h2>
            {liquidaciones.length === 0 ? <p className="suave chico">Aún no hay liquidaciones. WOPA liquida cada quincena las estadías completadas.</p> : (
              <ul className="pila" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {liquidaciones.map((l) => (
                  <li key={l.id} className="cifra">{l.periodo_desde} → {l.periodo_hasta} · {dinero(l.total, l.moneda_codigo, "es")} · {l.estado}{l.referencia_transferencia ? ` · ${l.referencia_transferencia}` : ""}</li>
                ))}
              </ul>
            )}
          </div>
          <form action={ticketExtranet} className="tarjeta pila">
            <h2>Escribir a WOPA</h2>
            <input type="hidden" name="hotelId" value={id} />
            <input type="hidden" name="hotelNombre" value={hotel.nombre} />
            <div className="campo"><label htmlFor="asunto">Asunto</label><input id="asunto" name="asunto" required minLength={3} /></div>
            <div className="campo"><label htmlFor="mensaje">Mensaje</label><textarea id="mensaje" name="mensaje" required minLength={5} /></div>
            <div><button className="boton secundario" type="submit">Enviar</button></div>
          </form>
        </section>
      </div>
    </div>
  );
}
