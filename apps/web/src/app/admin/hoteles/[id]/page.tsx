import Link from "next/link";
import { notFound } from "next/navigation";
import { detalleHotelAdmin, historialMargenes } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { dinero, hoyMas, porcentaje } from "@/lib/formato";
import { exigirWopa } from "@/lib/sesion";
import {
  aceptarHotelAccion,
  ajustarMargenAccion,
  cargarCuposAccion,
  cargarTarifaAccion,
  crearHabitacionAccion,
  invitarAccion,
} from "../../acciones";

const ROLES: Record<string, string> = { hotel_admin: "Administración", hotel_recepcion: "Recepción" };

function CamposMargen() {
  return (
    <div className="rejilla-2">
      <div className="campo">
        <label htmlFor="margenTipo">Tipo de margen</label>
        <select id="margenTipo" name="margenTipo" defaultValue="porcentaje">
          <option value="porcentaje">Porcentaje sobre la tarifa neta</option>
          <option value="monto_fijo">Monto fijo por noche</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor="margenValor">Valor</label>
        <input id="margenValor" name="margenValor" inputMode="decimal" required placeholder="30" aria-describedby="ayuda-margen" />
        <span id="ayuda-margen" className="ayuda">Ej.: 30 (%) → neta 50.000 + 15.000 = 65.000 al público.</span>
      </div>
    </div>
  );
}

export default async function PaginaHotel({ params, searchParams }: PageProps<"/admin/hoteles/[id]">) {
  const sesion = await exigirWopa();
  const { id } = await params;
  const { error, ok, creado } = await searchParams;
  const hotel = await detalleHotelAdmin(sesion, id);
  if (!hotel) notFound();
  const margenes = await historialMargenes(sesion, id);
  const mensaje = mensajeDeError(error);
  const aceptado = hotel.aceptado_en !== null;

  return (
    <div className="pila">
      <div className="fila entre">
        <div>
          <p className="chico"><Link href="/admin">← Hoteles</Link></p>
          <h1>{hotel.nombre}</h1>
          <p className="suave">
            {hotel.ciudad} · {hotel.direccion} · <span className={`etiqueta-estado e-${hotel.estado}`}>{hotel.estado.replace("_", " ")}</span>{" "}
            · {hotel.modo_reserva === "solicitud" ? "Bajo solicitud" : "Anticipo en línea"} · tarifas en {hotel.moneda}
          </p>
        </div>
        {hotel.estado === "publicado" && <Link className="boton secundario" href={`/es/hotel/${hotel.slug}`}>Ver en la web</Link>}
      </div>

      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {ok && <p className="aviso exito" role="status">Cambios guardados.</p>}
      {creado && <p className="aviso info" role="status">Hotel creado en borrador. Agrega habitaciones y tarifas, invita a su responsable y acéptalo con su margen.</p>}

      {!aceptado && (
        <section className="tarjeta pila" aria-labelledby="titulo-aceptar">
          <h2 id="titulo-aceptar">Aceptar y publicar</h2>
          <p className="suave">Configura el margen acordado con el hotel. Sin margen no se puede publicar (ADR-008).</p>
          <form action={aceptarHotelAccion} className="pila">
            <input type="hidden" name="hotelId" value={hotel.id} />
            <CamposMargen />
            <div className="campo">
              <label htmlFor="motivo-aceptar">Nota del acuerdo</label>
              <input id="motivo-aceptar" name="motivo" placeholder="Margen acordado en reunión del 14 de octubre" />
            </div>
            <div><button className="boton dorado" type="submit" disabled={hotel.habitaciones.length === 0}>Aceptar con este margen y publicar</button></div>
            {hotel.habitaciones.length === 0 && <p className="chico suave">Primero agrega al menos una habitación con tarifa.</p>}
          </form>
        </section>
      )}

      {aceptado && (
        <section className="tarjeta pila" aria-labelledby="titulo-margenes">
          <h2 id="titulo-margenes">Márgenes de WOPA</h2>
          <div className="tabla-contenedor">
            <table>
              <thead><tr><th>Vigencia</th><th>Alcance</th><th>Margen</th><th>Motivo</th><th>Por</th></tr></thead>
              <tbody>
                {margenes.map((regla: Record<string, any>) => (
                  <tr key={regla.id}>
                    <td className="cifra">{regla.vigente_desde} → {regla.vigente_hasta ?? "sin fin"}</td>
                    <td>{regla.plan_tarifa_id ? hotel.planes.find((p) => p.id === regla.plan_tarifa_id)?.nombre ?? "Plan" : "Todo el hotel"}</td>
                    <td className="cifra">{regla.tipo === "porcentaje" ? porcentaje(regla.porcentaje_bp) : `${dinero(regla.monto_centavos, hotel.moneda, "es")} por noche`}</td>
                    <td>{regla.motivo}</td>
                    <td className="chico">{regla.creado_por}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary><strong>Ajustar margen</strong> <span className="suave chico">(aplica desde la fecha elegida; no cambia reservas hechas)</span></summary>
            <form action={ajustarMargenAccion} className="pila" style={{ marginTop: 12 }}>
              <input type="hidden" name="hotelId" value={hotel.id} />
              <CamposMargen />
              <div className="rejilla-3">
                <div className="campo"><label htmlFor="desde-margen">Desde</label><input id="desde-margen" name="desde" type="date" required defaultValue={hoyMas(1)} /></div>
                <div className="campo"><label htmlFor="hasta-margen">Hasta (opcional)</label><input id="hasta-margen" name="hasta" type="date" /></div>
                <div className="campo">
                  <label htmlFor="plan-margen">Alcance</label>
                  <select id="plan-margen" name="planTarifaId" defaultValue="">
                    <option value="">Todo el hotel</option>
                    {hotel.planes.map((plan) => <option key={plan.id} value={plan.id}>Solo plan {plan.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="campo"><label htmlFor="motivo-ajuste">Motivo</label><input id="motivo-ajuste" name="motivo" required minLength={3} placeholder="Temporada alta" /></div>
              <div><button className="boton" type="submit">Guardar ajuste</button></div>
            </form>
          </details>
        </section>
      )}

      <section className="tarjeta pila" aria-labelledby="titulo-habitaciones">
        <h2 id="titulo-habitaciones">Habitaciones</h2>
        {hotel.habitaciones.length === 0 ? <p className="suave">Sin habitaciones todavía.</p> : (
          <ul className="servicios">{hotel.habitaciones.map((h) => <li key={h.id}>{h.nombre} · hasta {h.capacidad_maxima} personas</li>)}</ul>
        )}
        <details>
          <summary><strong>Agregar habitación</strong></summary>
          <form action={crearHabitacionAccion} className="pila" style={{ marginTop: 12 }}>
            <input type="hidden" name="hotelId" value={hotel.id} />
            <div className="rejilla-3">
              <div className="campo"><label htmlFor="nombreEs">Nombre (español)</label><input id="nombreEs" name="nombreEs" required placeholder="Doble superior" /></div>
              <div className="campo"><label htmlFor="nombreEn">Nombre (inglés)</label><input id="nombreEn" name="nombreEn" placeholder="Superior double" /></div>
              <div className="campo"><label htmlFor="capacidad">Capacidad máxima</label><input id="capacidad" name="capacidad" type="number" min={1} max={12} required defaultValue={2} /></div>
            </div>
            <div className="rejilla-2">
              <div className="campo"><label htmlFor="descripcionEs">Descripción (español)</label><textarea id="descripcionEs" name="descripcionEs" /></div>
              <div className="campo"><label htmlFor="descripcionEn">Descripción (inglés)</label><textarea id="descripcionEn" name="descripcionEn" /></div>
            </div>
            <div><button className="boton" type="submit">Agregar</button></div>
          </form>
        </details>
      </section>

      {hotel.habitaciones.length > 0 && (
        <section className="tarjeta pila" aria-labelledby="titulo-tarifas">
          <h2 id="titulo-tarifas">Tarifa neta y cupos</h2>
          <p className="suave chico">La tarifa neta es lo que recibe el hotel. El público ve la neta más el margen de WOPA.</p>
          <div className="rejilla-2">
            <form action={cargarTarifaAccion} className="pila">
              <h3>Cargar tarifa neta por rango</h3>
              <input type="hidden" name="hotelId" value={hotel.id} />
              <div className="campo"><label htmlFor="hab-tarifa">Habitación</label>
                <select id="hab-tarifa" name="tipoHabitacionId">{hotel.habitaciones.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}</select></div>
              <div className="campo"><label htmlFor="plan-tarifa">Plan</label>
                <select id="plan-tarifa" name="planTarifaId">{hotel.planes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
              <div className="rejilla-2">
                <div className="campo"><label htmlFor="desde-tarifa">Desde</label><input id="desde-tarifa" name="desde" type="date" required defaultValue={hoyMas(0)} /></div>
                <div className="campo"><label htmlFor="hasta-tarifa">Hasta</label><input id="hasta-tarifa" name="hasta" type="date" required defaultValue={hoyMas(180)} /></div>
                <div className="campo"><label htmlFor="ocupacion">Personas</label><input id="ocupacion" name="ocupacion" type="number" min={1} max={12} defaultValue={2} required /></div>
                <div className="campo"><label htmlFor="neto">Neta por noche ({hotel.moneda})</label><input id="neto" name="neto" inputMode="decimal" required placeholder="100" /></div>
                <div className="campo"><label htmlFor="estanciaMinima">Estancia mínima</label><input id="estanciaMinima" name="estanciaMinima" type="number" min={1} max={60} defaultValue={1} /></div>
              </div>
              <div><button className="boton" type="submit">Guardar tarifa</button></div>
            </form>
            <form action={cargarCuposAccion} className="pila">
              <h3>Cupos por rango</h3>
              <input type="hidden" name="hotelId" value={hotel.id} />
              <div className="campo"><label htmlFor="hab-cupo">Habitación</label>
                <select id="hab-cupo" name="tipoHabitacionId">{hotel.habitaciones.map((h) => <option key={h.id} value={h.id}>{h.nombre}</option>)}</select></div>
              <div className="rejilla-2">
                <div className="campo"><label htmlFor="desde-cupo">Desde</label><input id="desde-cupo" name="desde" type="date" required defaultValue={hoyMas(0)} /></div>
                <div className="campo"><label htmlFor="hasta-cupo">Hasta</label><input id="hasta-cupo" name="hasta" type="date" required defaultValue={hoyMas(180)} /></div>
                <div className="campo"><label htmlFor="cupoTotal">Habitaciones a la venta</label><input id="cupoTotal" name="cupoTotal" type="number" min={0} max={500} placeholder="5" /></div>
              </div>
              <label className="fila chico"><input type="checkbox" name="cerrado" /> Cerrar la venta en esas fechas</label>
              <div><button className="boton" type="submit">Guardar cupos</button></div>
              {hotel.modo_reserva === "solicitud" && <p className="chico suave">Este hotel está bajo solicitud: los cupos son opcionales.</p>}
            </form>
          </div>
          {hotel.proximosPrecios.length > 0 && (
            <div className="tabla-contenedor">
              <table>
                <thead><tr><th>Habitación</th><th>Plan</th><th>Personas</th><th>Fechas</th><th>Neta</th></tr></thead>
                <tbody>
                  {hotel.proximosPrecios.map((p, i) => (
                    <tr key={i}><td>{p.habitacion}</td><td>{p.plan}</td><td className="cifra">{p.ocupacion}</td><td className="cifra">{p.desde} → {p.hasta} ({p.dias} días)</td><td className="cifra">{dinero(p.neto, hotel.moneda, "es")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="tarjeta pila" aria-labelledby="titulo-equipo">
        <h2 id="titulo-equipo">Equipo del hotel</h2>
        {hotel.equipo.length === 0 && hotel.invitaciones.length === 0 && <p className="suave">Aún nadie del hotel tiene acceso.</p>}
        <ul className="pila" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {hotel.equipo.map((m) => <li key={m.correo}>{m.nombre} · {m.correo} · {ROLES[m.rol] ?? m.rol}</li>)}
          {hotel.invitaciones.map((i) => <li key={i.correo} className="suave">{i.correo} · {ROLES[i.rol] ?? i.rol} · invitación pendiente</li>)}
        </ul>
        <form action={invitarAccion} className="rejilla-3" style={{ alignItems: "end" }}>
          <input type="hidden" name="hotelId" value={hotel.id} />
          <input type="hidden" name="organizacionId" value={hotel.organizacion_id} />
          <div className="campo"><label htmlFor="correo-invitar">Correo</label><input id="correo-invitar" name="correo" type="email" required /></div>
          <div className="campo"><label htmlFor="rol-invitar">Rol</label>
            <select id="rol-invitar" name="rol"><option value="hotel_admin">Administración</option><option value="hotel_recepcion">Recepción</option></select></div>
          <div><button className="boton" type="submit">Enviar invitación</button></div>
        </form>
      </section>
    </div>
  );
}
