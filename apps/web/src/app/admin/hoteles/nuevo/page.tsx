import { listarCiudades } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { exigirWopa } from "@/lib/sesion";
import { crearHotelAccion } from "../../acciones";

export default async function PaginaNuevoHotel({ searchParams }: PageProps<"/admin/hoteles/nuevo">) {
  await exigirWopa();
  const { error } = await searchParams;
  const ciudades = await listarCiudades("es");
  const mensaje = mensajeDeError(error);

  return (
    <div className="pila" style={{ maxWidth: 760 }}>
      <div>
        <h1>Nuevo hotel</h1>
        <p className="suave">El hotel queda en borrador. Después cargas habitaciones y tarifas, invitas a su responsable y lo aceptas con su margen.</p>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      <form action={crearHotelAccion} className="tarjeta pila">
        <div className="campo">
          <label htmlFor="nombre">Nombre del hotel</label>
          <input id="nombre" name="nombre" required minLength={2} maxLength={120} />
        </div>
        <div className="rejilla-2">
          <div className="campo">
            <label htmlFor="ciudadId">Ciudad</label>
            <select id="ciudadId" name="ciudadId" required>
              {ciudades.map((ciudad) => <option key={ciudad.id} value={ciudad.id}>{ciudad.nombre} ({ciudad.pais})</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="moneda">Moneda de la tarifa</label>
            <select id="moneda" name="moneda" defaultValue="USD">
              <option value="USD">USD · dólar</option>
              <option value="COP">COP · peso colombiano</option>
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="direccion">Dirección</label>
          <input id="direccion" name="direccion" required />
        </div>
        <div className="rejilla-2">
          <div className="campo">
            <label htmlFor="latitud">Latitud</label>
            <input id="latitud" name="latitud" type="number" step="0.000001" min={-90} max={90} required />
          </div>
          <div className="campo">
            <label htmlFor="longitud">Longitud</label>
            <input id="longitud" name="longitud" type="number" step="0.000001" min={-180} max={180} required />
            <span className="ayuda">Cópialas del pin del hotel en Google Maps.</span>
          </div>
        </div>
        <div className="rejilla-2">
          <div className="campo">
            <label htmlFor="categoria">Categoría (estrellas)</label>
            <select id="categoria" name="categoria" defaultValue="">
              <option value="">Sin categoría</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="modo">Modo de reserva</label>
            <select id="modo" name="modo" defaultValue="anticipo_en_linea">
              <option value="anticipo_en_linea">Anticipo en línea (con cupos)</option>
              <option value="solicitud">Bajo solicitud (el hotel confirma)</option>
            </select>
          </div>
        </div>
        <div className="rejilla-2">
          <div className="campo">
            <label htmlFor="correoReservas">Correo de reservas</label>
            <input id="correoReservas" name="correoReservas" type="email" />
          </div>
          <div className="campo">
            <label htmlFor="telefono">Teléfono</label>
            <input id="telefono" name="telefono" type="tel" />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="registroTurismo">Registro de turismo</label>
          <input id="registroTurismo" name="registroTurismo" />
          <span className="ayuda">ATP en Panamá; RNT en Colombia.</span>
        </div>
        <div><button className="boton" type="submit">Crear hotel en borrador</button></div>
      </form>
    </div>
  );
}
