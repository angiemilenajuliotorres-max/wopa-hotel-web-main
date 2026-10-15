import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { crearBaseMigrada, type BaseDePrueba } from "@wopa/db/pruebas";
import { aceptarHotel, cargarTarifaNeta, crearHotel, crearTipoHabitacion } from "../src/catalogo.ts";
import type { SesionActiva } from "../src/identidad.ts";
import { opcionesDePago } from "../src/pagos/index.ts";
import { checksumEventoWompi, firmaIntegridadWompi, ProveedorWompi } from "../src/pagos/proveedores/wompi.ts";
import { crearReserva } from "../src/reservas.ts";
import { crearResena, invitarAResenar, moderarResena, resenasDeHotel, resenasPendientes } from "../src/resenas.ts";
import { fecha, idCiudad, idPlanBase, sesionWopa } from "./ayudantes.ts";

let db: BaseDePrueba;
let wopa: SesionActiva;
before(async () => {
  db = await crearBaseMigrada();
  wopa = await sesionWopa(db);
});
after(async () => {
  await db.close();
});

describe("Wompi (Colombia, COP)", () => {
  test("firma de integridad: SHA256(referencia + monto + moneda + secreto)", () => {
    const esperada = createHash("sha256").update("REF-123" + "2500000" + "COP" + "integridad_secreto").digest("hex");
    assert.equal(firmaIntegridadWompi("REF-123", 2_500_000n, "COP", "integridad_secreto"), esperada);
  });

  test("solo acepta eventos con checksum válido y traduce el estado", async () => {
    Object.assign(process.env, {
      WOMPI_LLAVE_PUBLICA: "pub_test", WOMPI_LLAVE_PRIVADA: "prv_test", WOMPI_SECRETO_INTEGRIDAD: "int", WOMPI_SECRETO_EVENTOS: "eventos", WOMPI_URL_API: "https://sandbox.wompi.test/v1",
    });
    const wompi = new ProveedorWompi();
    assert.equal(wompi.disponible(), false); // falta WOMPI_VERIFICADO=1
    const data = { transaction: { id: "tx-1", reference: "pago-1", status: "APPROVED", amount_in_cents: 2_500_000, currency: "COP" } };
    const signature = { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: "" };
    signature.checksum = checksumEventoWompi({ data, signature, timestamp: 1_700_000_000 }, "eventos");
    const cuerpo = JSON.stringify({ event: "transaction.updated", data, signature, timestamp: 1_700_000_000 });
    const evento = await wompi.verificarNotificacion({ metodo: "POST", cabeceras: {}, consulta: {}, cuerpo });
    assert.deepEqual([evento.estado, evento.referenciaExterna, evento.monto?.centavos], ["capturado", "pago-1", 2_500_000n]);

    const alterado = JSON.stringify({ event: "transaction.updated", data: { transaction: { ...data.transaction, amount_in_cents: 1 } }, signature, timestamp: 1_700_000_000 });
    await assert.rejects(wompi.verificarNotificacion({ metodo: "POST", cabeceras: {}, consulta: {}, cuerpo: alterado }));
  });

  test("el enlace del checkout lleva la firma y la URL de retorno", async () => {
    const resultado = await new ProveedorWompi().crearPago({
      pagoId: "pago-2", reservaCodigo: "WP-AAAAAA", monto: { centavos: 1_000_000n, moneda: "COP" }, metodo: "tarjeta", descripcion: "Anticipo",
      comprador: { nombre: "Ana", correo: "ana@example.test" }, idioma: "es", urlRetorno: "https://wopa.test/es/reservar/WP-AAAAAA", urlNotificacion: "https://wopa.test/api", claveIdempotencia: "x",
    });
    assert.equal(resultado.tipo, "redireccion");
    const url = new URL(resultado.tipo === "redireccion" ? resultado.url : "");
    assert.equal(url.searchParams.get("signature:integrity"), firmaIntegridadWompi("pago-2", 1_000_000n, "COP", "int"));
    assert.equal(url.searchParams.get("redirect-url"), "https://wopa.test/es/reservar/WP-AAAAAA");
  });

  test("un hotel colombiano en COP enruta a métodos en COP (simulado mientras Wompi no esté verificado)", async () => {
    const opciones = await opcionesDePago({ paisCompradorCodigo: "CO", paisHotelCodigo: "CO", moneda: "COP" }, db);
    assert.deepEqual(opciones.map((o) => o.metodo).sort(), ["tarjeta", "transferencia"]);
    assert.ok(opciones.every((o) => o.proveedor === "simulado" && o.moneda === "COP"));
  });
});

describe("reseñas verificadas", () => {
  let codigo: string;
  let slug: string;
  const correo = "huesped@example.test";

  before(async () => {
    const ciudad = await idCiudad(db, "ciudad-de-panama");
    const hotel = await crearHotel(wopa, { nombre: "Hotel Reseñas", ciudadId: ciudad, monedaCodigo: "USD", direccion: "Calle 50", latitud: 8.98, longitud: -79.51, modoReserva: "solicitud" }, db);
    const habitacion = await crearTipoHabitacion(wopa, { hotelId: hotel.hotelId, codigo: "doble", capacidadMaxima: 2, nombre: { es: "Doble" } }, db);
    await cargarTarifaNeta(wopa, { hotelId: hotel.hotelId, planTarifaId: await idPlanBase(db, hotel.hotelId), tipoHabitacionId: habitacion, desde: fecha(1), hasta: fecha(20), ocupacion: 2, netoCentavos: 8_000n }, db);
    await aceptarHotel(wopa, { hotelId: hotel.hotelId, margen: { tipo: "porcentaje", porcentajeBp: 2000 }, desde: fecha(0) }, db);
    const reserva = await crearReserva({ hotelSlug: hotel.slug, tipoHabitacionId: habitacion, planTarifaId: await idPlanBase(db, hotel.hotelId), entrada: fecha(2), salida: fecha(3), huespedes: 2, idioma: "es", titular: { nombre: "Huésped", correo, telefono: "+50760000000" } }, db);
    codigo = reserva.codigo;
    slug = hotel.slug;
  });

  test("antes de la estadía no se puede opinar", async () => {
    await assert.rejects(crearResena({ codigo, correo, puntaje: 5, nombreVisible: "Ana", idioma: "es" }, db), { codigo: "NO_RESENABLE" });
  });

  test("tras la estadía se invita una vez, se opina una vez y se publica tras moderar", async () => {
    await db.query("UPDATE reservas.reservas SET estado = 'completada', fecha_entrada = current_date - 3, fecha_salida = current_date - 1 WHERE codigo = $1", [codigo]);
    assert.equal(await invitarAResenar("https://wopa.test", db), 1);
    assert.equal(await invitarAResenar("https://wopa.test", db), 0);

    await crearResena({ codigo, correo, puntaje: 4, comentario: "Muy buena ubicación y atención.", nombreVisible: "Ana P.", idioma: "es" }, db);
    await assert.rejects(crearResena({ codigo, correo, puntaje: 1, nombreVisible: "Ana", idioma: "es" }, db), { codigo: "RESENA_EXISTENTE" });
    assert.equal((await resenasDeHotel(slug, db)).cantidad, 0); // aún sin moderar

    const pendientes = await resenasPendientes(wopa, db);
    await moderarResena(wopa, pendientes[0].id, true, db);
    const publicadas = await resenasDeHotel(slug, db);
    assert.deepEqual([publicadas.cantidad, publicadas.promedio, publicadas.ultimas[0].nombre_visible], [1, 4, "Ana P."]);
  });
});
