import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { BaseDePrueba } from "./ayudantes.ts";
import { crearBaseMigrada, crearHotelDePrueba, insertar } from "./ayudantes.ts";

let db: BaseDePrueba;
before(async () => {
  db = await crearBaseMigrada();
});
after(async () => {
  await db.close();
});

const reglaMargen = `INSERT INTO tarifas.reglas_margen
  (hotel_id, plan_tarifa_id, tipo, porcentaje_bp, monto_centavos, vigente_desde, vigente_hasta, motivo, creado_por)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'Acuerdo de aceptación', $8) RETURNING id`;

describe("margen obligatorio para publicar (ADR-008)", () => {
  test("un hotel aceptado sin margen no se puede publicar", async () => {
    const { hotel } = await crearHotelDePrueba(db, "sin-margen");
    await assert.rejects(
      db.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [hotel]),
      /no tiene un margen vigente/,
    );
  });

  test("un margen que empieza en el futuro no habilita la publicación", async () => {
    const { hotel, usuarioWopa } = await crearHotelDePrueba(db, "margen-futuro");
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3000, null, "2999-01-01", null, usuarioWopa]);
    await assert.rejects(
      db.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [hotel]),
      /no tiene un margen vigente/,
    );
  });

  test("con un margen general vigente sí se publica", async () => {
    const { hotel, usuarioWopa } = await crearHotelDePrueba(db, "con-margen");
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3000, null, "2020-01-01", null, usuarioWopa]);
    await db.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [hotel]);
    const { rows } = await db.query<{ estado: string }>("SELECT estado FROM catalogo.hoteles WHERE id = $1", [hotel]);
    assert.equal(rows[0].estado, "publicado");
  });

  test("un hotel no aceptado no se puede publicar ni con margen", async () => {
    const { hotel, usuarioWopa } = await crearHotelDePrueba(db, "no-aceptado");
    await db.query("UPDATE catalogo.hoteles SET aceptado_por = NULL, aceptado_en = NULL WHERE id = $1", [hotel]);
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3000, null, "2020-01-01", null, usuarioWopa]);
    await assert.rejects(db.query("UPDATE catalogo.hoteles SET estado = 'publicado' WHERE id = $1", [hotel]), /check/i);
  });
});

describe("reglas de margen", () => {
  test("dos reglas del mismo alcance no pueden solaparse", async () => {
    const { hotel, usuarioWopa } = await crearHotelDePrueba(db, "solape");
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3000, null, "2026-01-01", "2026-12-14", usuarioWopa]);
    await assert.rejects(
      db.query(reglaMargen, [hotel, null, "porcentaje", 3500, null, "2026-12-01", null, usuarioWopa]),
      /reglas_margen_sin_solape/,
    );
    // El ajuste correcto empieza el día siguiente al cierre de la regla anterior.
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3500, null, "2026-12-15", null, usuarioWopa]);
  });

  test("una regla del plan puede coincidir en fechas con la del hotel", async () => {
    const { hotel, plan, usuarioWopa } = await crearHotelDePrueba(db, "plan-y-hotel");
    await db.query(reglaMargen, [hotel, null, "porcentaje", 3000, null, "2026-01-01", null, usuarioWopa]);
    await db.query(reglaMargen, [hotel, plan, "monto_fijo", null, 1500, "2026-12-15", "2027-01-15", usuarioWopa]);
  });

  test("el tipo define qué campo lleva valor", async () => {
    const { hotel, usuarioWopa } = await crearHotelDePrueba(db, "tipo-margen");
    await assert.rejects(
      db.query(reglaMargen, [hotel, null, "porcentaje", 3000, 1500, "2026-01-01", null, usuarioWopa]),
      /check/i,
    );
  });

  test("no acepta el plan de otro hotel", async () => {
    const a = await crearHotelDePrueba(db, "margen-hotel-a");
    const b = await crearHotelDePrueba(db, "margen-hotel-b");
    await assert.rejects(
      db.query(reglaMargen, [a.hotel, b.plan, "porcentaje", 3000, null, "2026-01-01", null, a.usuarioWopa]),
      /foreign key/i,
    );
  });
});

describe("cupos y precios", () => {
  test("la base impide vender más de lo disponible", async () => {
    const { habitacion } = await crearHotelDePrueba(db, "cupos");
    await db.query(
      "INSERT INTO tarifas.cupos_dia (tipo_habitacion_id, fecha, cupo_total) SELECT $1, d::date, 2 FROM generate_series('2026-12-01'::date, '2026-12-03', '1 day') d",
      [habitacion],
    );
    await assert.rejects(
      db.query("UPDATE tarifas.cupos_dia SET cupo_vendido = 3 WHERE tipo_habitacion_id = $1 AND fecha = '2026-12-01'", [habitacion]),
      /cupos_dia_sin_sobreventa/,
    );
  });

  test("la retención condicional solo descuenta si hay cupo en todas las noches", async () => {
    const { habitacion } = await crearHotelDePrueba(db, "retencion");
    await db.query(
      "INSERT INTO tarifas.cupos_dia (tipo_habitacion_id, fecha, cupo_total, cupo_vendido) VALUES ($1, '2026-12-01', 1, 0), ($1, '2026-12-02', 1, 1)",
      [habitacion],
    );
    const retener = `UPDATE tarifas.cupos_dia SET cupo_vendido = cupo_vendido + 1
      WHERE tipo_habitacion_id = $1 AND fecha >= $2 AND fecha < $3 AND NOT esta_cerrado AND cupo_total - cupo_vendido >= 1`;
    const resultado = await db.query(retener, [habitacion, "2026-12-01", "2026-12-03"]);
    assert.equal(resultado.rowCount, 1); // 1 de 2 noches → el servicio hace ROLLBACK
  });

  test("el precio neto no acepta un plan y una habitación de hoteles distintos", async () => {
    const a = await crearHotelDePrueba(db, "precio-a");
    const b = await crearHotelDePrueba(db, "precio-b");
    await assert.rejects(
      db.query(
        "INSERT INTO tarifas.precios_dia (hotel_id, plan_tarifa_id, tipo_habitacion_id, fecha, ocupacion, monto_neto_centavos) VALUES ($1, $2, $3, '2026-12-01', 2, 5000)",
        [a.hotel, a.plan, b.habitacion],
      ),
      /foreign key/i,
    );
  });
});

describe("reservas", () => {
  async function crearReserva(slug: string, cambios: { entrada?: string; salida?: string } = {}) {
    const datos = await crearHotelDePrueba(db, slug);
    const reserva = await insertar(
      db,
      `INSERT INTO reservas.reservas (codigo, hotel_id, estado, fecha_entrada, fecha_salida, idioma_codigo, moneda_codigo,
         total_venta_centavos, anticipo_centavos, titular_nombre, titular_correo, titular_telefono, politica_cancelacion, retenida_hasta)
       VALUES ($1, $2, 'retenida', $3, $4, 'es', 'USD', 6500, 1625, 'Ana Pérez', 'ana@example.test', '+5076000000', '{}', now() + interval '15 minutes')
       RETURNING id`,
      [`WP-${slug.slice(0, 6).toUpperCase().padEnd(6, "X")}`, datos.hotel, cambios.entrada ?? "2026-12-01", cambios.salida ?? "2026-12-02"],
    );
    return { ...datos, reserva };
  }

  test("el saldo se calcula solo y el precio por noche suma neta + margen", async () => {
    const { reserva, hotel, habitacion, plan } = await crearReserva("saldos");
    const { rows } = await db.query<{ saldo_centavos: string }>("SELECT saldo_centavos FROM reservas.reservas WHERE id = $1", [reserva]);
    assert.equal(Number(rows[0].saldo_centavos), 4875);

    const linea = await insertar(
      db,
      "INSERT INTO reservas.reserva_lineas (reserva_id, hotel_id, tipo_habitacion_id, plan_tarifa_id, adultos) VALUES ($1, $2, $3, $4, 2) RETURNING id",
      [reserva, hotel, habitacion, plan],
    );
    await db.query(
      "INSERT INTO reservas.reserva_noches (reserva_linea_id, fecha, monto_neto_centavos, margen_centavos) VALUES ($1, '2026-12-01', 5000, 1500)",
      [linea],
    );
    const noche = await db.query<{ venta: string }>("SELECT monto_venta_centavos AS venta FROM reservas.reserva_noches WHERE reserva_linea_id = $1", [linea]);
    assert.equal(Number(noche.rows[0].venta), 6500);
  });

  test("la salida debe ser posterior a la entrada", async () => {
    await assert.rejects(crearReserva("fechas", { entrada: "2026-12-02", salida: "2026-12-02" }), /check/i);
  });

  test("cada cambio de estado queda en el historial", async () => {
    const { reserva } = await crearReserva("historia");
    await db.query("UPDATE reservas.reservas SET estado = 'pendiente_pago' WHERE id = $1", [reserva]);
    await db.query("UPDATE reservas.reservas SET estado = 'confirmada', retenida_hasta = NULL WHERE id = $1", [reserva]);
    const { rows } = await db.query<{ estado_anterior: string | null; estado_nuevo: string }>(
      "SELECT estado_anterior, estado_nuevo FROM reservas.historial_estados WHERE reserva_id = $1 ORDER BY creado_en, id",
      [reserva],
    );
    assert.deepEqual(rows, [
      { estado_anterior: null, estado_nuevo: "retenida" },
      { estado_anterior: "retenida", estado_nuevo: "pendiente_pago" },
      { estado_anterior: "pendiente_pago", estado_nuevo: "confirmada" },
    ]);
  });

  test("una línea no puede usar la habitación de otro hotel", async () => {
    const { reserva, hotel, plan } = await crearReserva("lineas");
    const otro = await crearHotelDePrueba(db, "lineas-otro");
    await assert.rejects(
      db.query(
        "INSERT INTO reservas.reserva_lineas (reserva_id, hotel_id, tipo_habitacion_id, plan_tarifa_id, adultos) VALUES ($1, $2, $3, $4, 2)",
        [reserva, hotel, otro.habitacion, plan],
      ),
      /foreign key/i,
    );
  });
});

describe("identidad y catálogo", () => {
  test("los roles de WOPA solo existen en la organización WOPA", async () => {
    const { organizacion, usuarioWopa } = await crearHotelDePrueba(db, "roles");
    await assert.rejects(
      db.query(
        "INSERT INTO identidad.membresias (usuario_id, organizacion_id, organizacion_tipo, rol) VALUES ($1, $2, 'hotel', 'wopa_admin')",
        [usuarioWopa, organizacion],
      ),
      /check/i,
    );
    await db.query(
      "INSERT INTO identidad.membresias (usuario_id, organizacion_id, organizacion_tipo, rol) VALUES ($1, $2, 'hotel', 'hotel_admin')",
      [usuarioWopa, organizacion],
    );
  });

  test("no se puede declarar un tipo de organización falso", async () => {
    const { organizacion, usuarioWopa } = await crearHotelDePrueba(db, "tipo-falso");
    await assert.rejects(
      db.query(
        "INSERT INTO identidad.membresias (usuario_id, organizacion_id, organizacion_tipo, rol) VALUES ($1, $2, 'wopa', 'wopa_admin')",
        [usuarioWopa, organizacion],
      ),
      /foreign key/i,
    );
  });

  test("una foto no puede apuntar a la habitación de otro hotel", async () => {
    const a = await crearHotelDePrueba(db, "fotos-a");
    const b = await crearHotelDePrueba(db, "fotos-b");
    await assert.rejects(
      db.query("INSERT INTO catalogo.fotos (hotel_id, tipo_habitacion_id, url) VALUES ($1, $2, 'https://img.test/1.jpg')", [a.hotel, b.habitacion]),
      /foreign key/i,
    );
  });

  test("el autocompletado de ciudades ignora tildes y mayúsculas", async () => {
    const { rows } = await db.query<{ nombre: string }>(
      "SELECT nombre FROM geo.ciudad_traducciones WHERE idioma_codigo = 'es' AND public.sin_acentos(nombre) ILIKE public.sin_acentos($1) || '%'",
      ["CIUDAD DE PANAMA"],
    );
    assert.deepEqual(rows.map((fila) => fila.nombre), ["Ciudad de Panamá"]);
  });
});

describe("pagos, soporte y auditoría", () => {
  async function reservaConfirmable(slug: string) {
    const datos = await crearHotelDePrueba(db, slug);
    const reserva = await insertar(
      db,
      `INSERT INTO reservas.reservas (codigo, hotel_id, estado, fecha_entrada, fecha_salida, idioma_codigo, moneda_codigo,
         total_venta_centavos, anticipo_centavos, titular_nombre, titular_correo, titular_telefono, politica_cancelacion)
       VALUES ($1, $2, 'pendiente_pago', '2026-12-01', '2026-12-03', 'es', 'USD', 26000, 6500, 'Luis Gómez', 'luis@example.test', '+5076111111', '{}')
       RETURNING id`,
      [`WP-${slug.slice(0, 6).toUpperCase().padEnd(6, "Z")}`, datos.hotel],
    );
    return { ...datos, reserva };
  }

  test("un webhook repetido no se registra dos veces", async () => {
    const insertarEvento = "INSERT INTO pagos.eventos_pasarela (proveedor_codigo, evento_id, tipo, payload) VALUES ('simulado', 'evt_1', 'pago.capturado', '{}') ON CONFLICT DO NOTHING";
    const primero = await db.query(insertarEvento);
    const segundo = await db.query(insertarEvento);
    assert.equal(primero.rowCount, 1);
    assert.equal(segundo.rowCount, 0);
  });

  test("los asientos de una operación deben cuadrar", async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion) VALUES (gen_random_uuid(), 'gasto_operativo', 1000, 'USD', 'Solo un lado')",
      ),
      /no cuadra/,
    );
  });

  test("los asientos contables no se editan ni se borran", async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO pagos.asientos (operacion_id, cuenta, monto_centavos, moneda_codigo, descripcion)
       SELECT op, cuenta, monto, 'USD', 'Pago de luz' FROM (SELECT gen_random_uuid() AS op) o,
       (VALUES ('gasto_operativo', 1000), ('caja_proveedor', -1000)) AS v (cuenta, monto)
       RETURNING id`,
    );
    const asiento = rows[0].id;
    await assert.rejects(db.query("UPDATE pagos.asientos SET monto_centavos = 1 WHERE id = $1", [asiento]), /no se editan/);
    await assert.rejects(db.query("DELETE FROM pagos.asientos WHERE id = $1", [asiento]), /no se editan/);
  });

  test("el pago registra su historial y una reserva se liquida una sola vez", async () => {
    const { reserva, hotel, usuarioWopa } = await reservaConfirmable("liquida");
    const pago = await insertar(
      db,
      "INSERT INTO pagos.pagos (reserva_id, proveedor_codigo, metodo, concepto, monto_centavos, moneda_codigo, clave_idempotencia) VALUES ($1, 'simulado', 'tarjeta', 'anticipo', 6500, 'USD', gen_random_uuid()) RETURNING id",
      [reserva],
    );
    await db.query("UPDATE pagos.pagos SET estado = 'capturado' WHERE id = $1", [pago]);
    const historial = await db.query<{ estado_nuevo: string }>("SELECT estado_nuevo FROM pagos.historial_estados WHERE pago_id = $1 ORDER BY creado_en, id", [pago]);
    assert.deepEqual(historial.rows.map((fila) => fila.estado_nuevo), ["pendiente", "capturado"]);

    const crearLiquidacion = (desde: string) =>
      insertar(
        db,
        "INSERT INTO pagos.liquidaciones (hotel_id, periodo_desde, periodo_hasta, moneda_codigo, creado_por) VALUES ($1, $2, $2::date + 14, 'USD', $3) RETURNING id",
        [hotel, desde, usuarioWopa],
      );
    const primera = await crearLiquidacion("2026-12-01");
    const segunda = await crearLiquidacion("2026-12-16");
    await db.query("INSERT INTO pagos.liquidacion_lineas (liquidacion_id, reserva_id, monto_centavos) VALUES ($1, $2, 500)", [primera, reserva]);
    await assert.rejects(
      db.query("INSERT INTO pagos.liquidacion_lineas (liquidacion_id, reserva_id, monto_centavos) VALUES ($1, $2, 500)", [segunda, reserva]),
      /duplicate key/,
    );
  });

  test("las reglas de enrutamiento no se duplican aunque tengan países vacíos", async () => {
    await assert.rejects(
      db.query("INSERT INTO pagos.reglas_enrutamiento (proveedor_codigo, metodo, moneda_codigo) VALUES ('paguelofacil', 'tarjeta', 'USD')"),
      /duplicate key/,
    );
  });

  test("el ticket registra su historial y exige fecha de resolución al resolverse", async () => {
    const ticket = await insertar(
      db,
      `INSERT INTO soporte.tickets (codigo, categoria_codigo, origen, asunto, idioma_codigo, solicitante_nombre, solicitante_correo, vence_sla_en)
       VALUES ('TK-000001', 'pago', 'asistente', 'No veo mi pago', 'es', 'Ana', 'ana@example.test', now() + interval '4 hours') RETURNING id`,
    );
    await assert.rejects(db.query("UPDATE soporte.tickets SET estado = 'resuelto' WHERE id = $1", [ticket]), /check/i);
    await db.query("UPDATE soporte.tickets SET estado = 'resuelto', resuelto_en = now() WHERE id = $1", [ticket]);
    const historial = await db.query<{ estado_nuevo: string }>("SELECT estado_nuevo FROM soporte.historial_estados WHERE ticket_id = $1 ORDER BY creado_en, id", [ticket]);
    assert.deepEqual(historial.rows.map((fila) => fila.estado_nuevo), ["abierto", "resuelto"]);
  });

  test("solo hay una alerta abierta por tipo y entidad", async () => {
    const alerta = "INSERT INTO auditoria.alertas (tipo, severidad, entidad, entidad_id) VALUES ('precio_anomalo', 'advertencia', 'hotel', 'h-1')";
    await db.query(alerta);
    await assert.rejects(db.query(alerta), /duplicate key/);
  });
});
