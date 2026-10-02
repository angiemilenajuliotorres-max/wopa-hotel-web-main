const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const ExcelJS = require("exceljs");
const db = require("../db/conexion");

const router = express.Router();
const COOKIE_NAME = "wopa_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Demasiados intentos. Espera 15 minutos antes de volver a entrar." },
});

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function firma(payload) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(payload).digest("base64url");
}

function obtenerCookie(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const cookie = cookies.map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  return cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : "";
}

function limpiarCookie(res, req) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function emitirCookie(res, req, usuario) {
  const payload = Buffer.from(JSON.stringify({ sub: usuario, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  const token = `${payload}.${firma(payload)}`;
  const secure = req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
}

function autenticar(req, res, next) {
  if (!process.env.ADMIN_SESSION_SECRET || !process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ ok: false, error: "El acceso administrativo no está configurado en el servidor." });
  }

  try {
    const token = obtenerCookie(req);
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra || !safeEqual(signature, firma(payload))) throw new Error("Firma inválida");
    const sesion = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!sesion.sub || sesion.exp <= Math.floor(Date.now() / 1000)) throw new Error("Sesión expirada");
    req.admin = { usuario: sesion.sub };
    next();
  } catch {
    limpiarCookie(res, req);
    res.status(401).json({ ok: false, error: "Inicia sesión para continuar." });
  }
}

function validarOrigen(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({ ok: false, error: "Origen de solicitud no permitido." });
      }
    } catch {
      return res.status(403).json({ ok: false, error: "Origen de solicitud no permitido." });
    }
  }
  next();
}

function texto(valor, limite = 500) {
  return typeof valor === "string" ? valor.trim().slice(0, limite) : "";
}

function montoValido(valor) {
  const monto = Number(valor);
  return Number.isFinite(monto) && monto > 0 && monto <= 10000000 ? Math.round(monto * 100) / 100 : null;
}

function noEncontrado(res, entidad) {
  return res.status(404).json({ ok: false, error: `${entidad} no encontrado.` });
}

router.post("/login", loginLimiter, (req, res) => {
  const usuario = texto(req.body.usuario, 100);
  const clave = typeof req.body.clave === "string" ? req.body.clave : "";
  const configurado = process.env.ADMIN_USER && process.env.ADMIN_PASSWORD?.length >= 6 && process.env.ADMIN_SESSION_SECRET?.length >= 32;
  const valido = configurado && safeEqual(usuario, process.env.ADMIN_USER) && safeEqual(clave, process.env.ADMIN_PASSWORD);

  if (!valido) {
    return res.status(configurado ? 401 : 503).json({
      ok: false,
      error: configurado ? "Usuario o contraseña incorrectos." : "Configura ADMIN_USER, ADMIN_PASSWORD y un ADMIN_SESSION_SECRET de 32 caracteres o más.",
    });
  }

  emitirCookie(res, req, usuario);
  res.json({ ok: true, usuario });
});

router.post("/logout", validarOrigen, (req, res) => {
  limpiarCookie(res, req);
  res.json({ ok: true });
});

router.use(autenticar, validarOrigen);

router.get("/me", (req, res) => res.json({ ok: true, usuario: req.admin.usuario }));

router.get("/resumen", (req, res) => {
  try {
    const solicitudes = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM solicitudes_reserva) AS reservas,
        (SELECT COUNT(*) FROM solicitudes_reserva WHERE estado = 'pendiente_confirmacion') AS reservas_pendientes,
        (SELECT COUNT(*) FROM solicitudes_cotizacion WHERE estado IN ('pendiente', 'en_revision', 'estimado_parcial')) AS cotizaciones_pendientes,
        (SELECT COUNT(*) FROM mensajes_contacto WHERE estado IN ('nuevo', 'en_revision')) AS mensajes_pendientes,
        (SELECT COALESCE(SUM(monto_usd), 0) FROM movimientos_financieros WHERE tipo = 'ingreso') AS ingresos_usd,
        (SELECT COALESCE(SUM(monto_usd), 0) FROM movimientos_financieros WHERE tipo = 'egreso') AS gastos_usd,
        (SELECT COALESCE(SUM(monto_penalizacion_usd), 0) FROM solicitudes_reserva WHERE estado = 'cancelada') AS penalizaciones_usd
    `).get();
    solicitudes.ingresos_usd = Number(solicitudes.ingresos_usd);
    solicitudes.gastos_usd = Number(solicitudes.gastos_usd);
    solicitudes.penalizaciones_usd = Number(solicitudes.penalizaciones_usd);
    solicitudes.utilidad_neta_usd = Math.round((solicitudes.ingresos_usd - solicitudes.gastos_usd) * 100) / 100;
    res.json({ ok: true, data: solicitudes });
  } catch (error) {
    console.error("Error al generar resumen administrativo:", error);
    res.status(500).json({ ok: false, error: "No se pudo generar el resumen." });
  }
});

router.get("/reservas", (req, res) => {
  const reservas = db.prepare(`
    SELECT r.*, t.nombre AS hotel,
      COALESCE((SELECT SUM(m.monto_usd) FROM movimientos_financieros m WHERE m.solicitud_reserva_id = r.id AND m.tipo = 'ingreso'), 0) AS abonado_usd
    FROM solicitudes_reserva r
    JOIN tipos_habitacion t ON t.id = r.tipo_id
    ORDER BY r.created_at DESC
  `).all().map((reserva) => ({ ...reserva, abonado_usd: Number(reserva.abonado_usd) }));
  res.json({ ok: true, data: reservas });
});

router.patch("/reservas/:id", (req, res) => {
  const id = Number(req.params.id);
  const estados = ["pendiente_confirmacion", "confirmada", "rechazada", "cancelada", "completada"];
  const estado = texto(req.body.estado, 40);
  const notaAdmin = texto(req.body.notaAdmin, 1200);
  const motivo = texto(req.body.motivoCancelacion, 500);
  if (!Number.isInteger(id) || !estados.includes(estado)) return res.status(400).json({ ok: false, error: "Estado de reserva no válido." });
  if (estado === "cancelada" && motivo.length < 3) return res.status(400).json({ ok: false, error: "Indica el motivo de cancelación." });

  try {
    const reserva = db.prepare("SELECT id, estado FROM solicitudes_reserva WHERE id = ?").get(id);
    if (!reserva) return noEncontrado(res, "Reserva");
    if (reserva.estado === "cancelada" && estado !== "cancelada") {
      return res.status(409).json({ ok: false, error: "Una reserva cancelada no se puede reactivar desde el panel." });
    }

    const actualizar = db.transaction(() => {
      const pagos = db.prepare(`SELECT COALESCE(SUM(monto_usd), 0) AS total FROM movimientos_financieros WHERE solicitud_reserva_id = ? AND tipo = 'ingreso'`).get(id);
      const penalizacion = estado === "cancelada" ? Math.round(Number(pagos.total) * 100) / 100 : 0;
      db.prepare(`
        UPDATE solicitudes_reserva
        SET estado = ?, nota_admin = ?,
            monto_penalizacion_usd = ?,
            fecha_cancelacion = CASE WHEN ? = 'cancelada' THEN CURRENT_TIMESTAMP ELSE fecha_cancelacion END,
            motivo_cancelacion = CASE WHEN ? = 'cancelada' THEN ? ELSE motivo_cancelacion END
        WHERE id = ?
      `).run(estado, notaAdmin || null, penalizacion, estado, estado, motivo || null, id);
      return penalizacion;
    });
    const penalizacion = actualizar();
    res.json({ ok: true, penalizacionUsd: penalizacion, data: db.prepare("SELECT id, estado, monto_penalizacion_usd FROM solicitudes_reserva WHERE id = ?").get(id) });
  } catch (error) {
    console.error("Error al actualizar reserva:", error);
    res.status(500).json({ ok: false, error: "No se pudo actualizar la reserva." });
  }
});

router.post("/reservas/:id/pagos", (req, res) => {
  const id = Number(req.params.id);
  const monto = montoValido(req.body.montoUsd);
  const referencia = texto(req.body.referencia, 160);
  if (!Number.isInteger(id) || !monto) return res.status(400).json({ ok: false, error: "Indica un monto de pago válido." });

  try {
    const reserva = db.prepare("SELECT id, codigo, subtotal_usd, estado FROM solicitudes_reserva WHERE id = ?").get(id);
    if (!reserva) return noEncontrado(res, "Reserva");
    if (["cancelada", "rechazada"].includes(reserva.estado)) return res.status(409).json({ ok: false, error: "No se registran pagos en una reserva cancelada o rechazada." });
    const abonado = db.prepare("SELECT COALESCE(SUM(monto_usd), 0) AS total FROM movimientos_financieros WHERE solicitud_reserva_id = ? AND tipo = 'ingreso'").get(id).total;
    if (Number(abonado) + monto > Number(reserva.subtotal_usd) + 0.001) return res.status(400).json({ ok: false, error: "El pago excede el total del hospedaje pendiente." });

    const resultado = db.prepare(`
      INSERT INTO movimientos_financieros (tipo, categoria, descripcion, monto_usd, solicitud_reserva_id, creado_por)
      VALUES ('ingreso', 'Pago de hospedaje', ?, ?, ?, ?)
    `).run(`Pago ${reserva.codigo}${referencia ? ` · Ref. ${referencia}` : ""}`, monto, id, req.admin.usuario);
    res.status(201).json({ ok: true, id: resultado.lastInsertRowid, abonadoUsd: Number(abonado) + monto, saldoUsd: Number(reserva.subtotal_usd) - Number(abonado) - monto });
  } catch (error) {
    console.error("Error al registrar pago:", error);
    res.status(500).json({ ok: false, error: "No se pudo registrar el pago." });
  }
});

router.get("/cotizaciones", (req, res) => {
  const cotizaciones = db.prepare(`
    SELECT c.*, t.nombre AS hotel, e.nombre AS experiencia
    FROM solicitudes_cotizacion c
    LEFT JOIN tipos_habitacion t ON t.id = c.tipo_id
    LEFT JOIN experiencias e ON e.id = c.experiencia_id
    ORDER BY c.created_at DESC
  `).all();
  res.json({ ok: true, data: cotizaciones });
});

router.patch("/cotizaciones/:id", (req, res) => {
  const id = Number(req.params.id);
  const estado = texto(req.body.estado, 40);
  const nota = texto(req.body.notaAdmin, 1200);
  if (!Number.isInteger(id) || !["pendiente", "en_revision", "cotizada", "aceptada", "rechazada", "generada_automatica", "estimado_parcial"].includes(estado)) {
    return res.status(400).json({ ok: false, error: "Estado de cotización no válido." });
  }
  const result = db.prepare("UPDATE solicitudes_cotizacion SET estado = ?, nota_admin = ? WHERE id = ?").run(estado, nota || null, id);
  if (!result.changes) return noEncontrado(res, "Cotización");
  res.json({ ok: true });
});

router.get("/contactos", (req, res) => {
  const contactos = db.prepare("SELECT * FROM mensajes_contacto ORDER BY created_at DESC").all();
  res.json({ ok: true, data: contactos });
});

router.patch("/contactos/:id", (req, res) => {
  const id = Number(req.params.id);
  const estado = texto(req.body.estado, 40);
  const nota = texto(req.body.notaAdmin, 1200);
  if (!Number.isInteger(id) || !["nuevo", "en_revision", "resuelto"].includes(estado)) {
    return res.status(400).json({ ok: false, error: "Estado de contacto no válido." });
  }
  const result = db.prepare("UPDATE mensajes_contacto SET estado = ?, nota_admin = ? WHERE id = ?").run(estado, nota || null, id);
  if (!result.changes) return noEncontrado(res, "Mensaje");
  res.json({ ok: true });
});

router.get("/movimientos", (req, res) => {
  const movimientos = db.prepare(`
    SELECT m.*, r.codigo AS reserva_codigo
    FROM movimientos_financieros m
    LEFT JOIN solicitudes_reserva r ON r.id = m.solicitud_reserva_id
    ORDER BY m.fecha DESC, m.id DESC
  `).all();
  res.json({ ok: true, data: movimientos });
});

router.post("/movimientos", (req, res) => {
  const tipo = texto(req.body.tipo, 20);
  const categoria = texto(req.body.categoria, 100);
  const descripcion = texto(req.body.descripcion, 500);
  const monto = montoValido(req.body.montoUsd);
  const fecha = texto(req.body.fecha, 10) || new Date().toISOString().slice(0, 10);
  if (!["ingreso", "egreso"].includes(tipo) || !categoria || !descripcion || !monto || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ ok: false, error: "Completa tipo, categoría, descripción, fecha y un monto válido." });
  }
  const resultado = db.prepare(`
    INSERT INTO movimientos_financieros (tipo, categoria, descripcion, monto_usd, fecha, creado_por)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tipo, categoria, descripcion, monto, fecha, req.admin.usuario);
  res.status(201).json({ ok: true, id: resultado.lastInsertRowid });
});

router.get("/catalogo", (req, res) => {
  const hoteles = db.prepare(`
    SELECT t.id, t.nombre, t.descripcion, t.capacidad_minima, t.capacidad_maxima, t.servicios,
      json_group_array(json_object('id', f.id, 'capacidad', f.capacidad_personas, 'precio_usd', f.precio_usd, 'temporada', f.temporada)) AS tarifas
    FROM tipos_habitacion t
    LEFT JOIN tarifas f ON f.tipo_id = t.id
    GROUP BY t.id
    ORDER BY t.nombre
  `).all().map((hotel) => ({ ...hotel, tarifas: JSON.parse(hotel.tarifas).filter((tarifa) => tarifa.id !== null) }));
  const experiencias = db.prepare("SELECT * FROM experiencias ORDER BY id").all();
  res.json({ ok: true, data: { hoteles, experiencias } });
});

router.post("/hoteles", (req, res) => {
  const nombre = texto(req.body.nombre, 160);
  const descripcion = texto(req.body.descripcion, 1000);
  const servicios = texto(req.body.servicios, 800);
  const precioDos = montoValido(req.body.precioDosUsd);
  const precioCuatro = montoValido(req.body.precioCuatroUsd);
  if (!nombre || !descripcion || !precioDos || !precioCuatro) {
    return res.status(400).json({ ok: false, error: "Indica nombre, descripción y tarifas válidas para 1–2 y 3–4 personas." });
  }

  try {
    const agencia = db.prepare("SELECT id FROM hoteles WHERE slug = 'wopa-travel-cartagena' LIMIT 1").get();
    if (!agencia) return res.status(409).json({ ok: false, error: "No se encontró el registro principal de WOPA Travel." });
    const crear = db.transaction(() => {
      const aliado = db.prepare(`
        INSERT INTO tipos_habitacion (hotel_id, nombre, descripcion, capacidad_minima, capacidad_maxima, servicios)
        VALUES (?, ?, ?, 1, 4, ?)
      `).run(agencia.id, nombre, descripcion, servicios || null);
      db.prepare(`INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada) VALUES (?, 2, ?, 'baja')`).run(aliado.lastInsertRowid, precioDos);
      db.prepare(`INSERT INTO tarifas (tipo_id, capacidad_personas, precio_usd, temporada) VALUES (?, 4, ?, 'baja')`).run(aliado.lastInsertRowid, precioCuatro);
      return aliado.lastInsertRowid;
    });
    res.status(201).json({ ok: true, id: crear() });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ ok: false, error: "Ya existe un aliado con ese nombre." });
    console.error("Error al crear hotel aliado:", error);
    res.status(500).json({ ok: false, error: "No se pudo crear el hotel aliado." });
  }
});

router.put("/hoteles/:id", (req, res) => {
  const id = Number(req.params.id);
  const nombre = texto(req.body.nombre, 160);
  const descripcion = texto(req.body.descripcion, 1000);
  const servicios = texto(req.body.servicios, 800);
  const capacidadMaxima = Number(req.body.capacidadMaxima);
  if (!Number.isInteger(id) || !nombre || !descripcion || !Number.isInteger(capacidadMaxima) || capacidadMaxima < 2 || capacidadMaxima > 4) {
    return res.status(400).json({ ok: false, error: "Revisa el nombre, descripción y capacidad máxima (2 a 4 personas, según las tarifas publicadas)." });
  }
  try {
    const result = db.prepare(`
      UPDATE tipos_habitacion
      SET nombre = ?, descripcion = ?, servicios = ?, capacidad_maxima = ?
      WHERE id = ?
    `).run(nombre, descripcion, servicios || null, capacidadMaxima, id);
    if (!result.changes) return noEncontrado(res, "Hotel aliado");
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ ok: false, error: "Ya existe un aliado con ese nombre." });
    }
    console.error("Error al actualizar hotel aliado:", error);
    res.status(500).json({ ok: false, error: "No se pudo actualizar el hotel aliado." });
  }
});

router.put("/tarifas/:id", (req, res) => {
  const id = Number(req.params.id);
  const monto = montoValido(req.body.precioUsd);
  if (!Number.isInteger(id) || !monto) return res.status(400).json({ ok: false, error: "Indica un precio válido en USD." });
  const result = db.prepare("UPDATE tarifas SET precio_usd = ? WHERE id = ?").run(monto, id);
  if (!result.changes) return noEncontrado(res, "Tarifa");
  res.json({ ok: true });
});

router.put("/experiencias/:id", (req, res) => {
  const id = Number(req.params.id);
  const nombre = texto(req.body.nombre, 140);
  const categoria = texto(req.body.categoria, 100);
  const descripcion = texto(req.body.descripcion, 1000);
  const duracion = texto(req.body.duracion, 100);
  const imagen = texto(req.body.imagenUrl, 500);
  const precio = req.body.precioUsd === "" || req.body.precioUsd === null ? null : montoValido(req.body.precioUsd);
  const unidadPrecio = texto(req.body.unidadPrecio, 20) || "persona";
  const activa = req.body.activa ? 1 : 0;
  if (!Number.isInteger(id) || !nombre || !categoria || !descripcion || !["persona", "grupo"].includes(unidadPrecio) || (req.body.precioUsd && !precio)) {
    return res.status(400).json({ ok: false, error: "Revisa el nombre, categoría, descripción y precio opcional." });
  }
  const result = db.prepare(`
    UPDATE experiencias SET nombre = ?, categoria = ?, descripcion = ?, duracion = ?, imagen_url = ?, precio_usd = ?, unidad_precio = ?, activa = ? WHERE id = ?
  `).run(nombre, categoria, descripcion, duracion || null, imagen || null, precio, unidadPrecio, activa, id);
  if (!result.changes) return noEncontrado(res, "Experiencia");
  res.json({ ok: true });
});

router.post("/experiencias", (req, res) => {
  const nombre = texto(req.body.nombre, 140);
  const categoria = texto(req.body.categoria, 100);
  const descripcion = texto(req.body.descripcion, 1000);
  const duracion = texto(req.body.duracion, 100);
  const imagen = texto(req.body.imagenUrl, 500);
  const precio = req.body.precioUsd === "" || req.body.precioUsd === null ? null : montoValido(req.body.precioUsd);
  const unidadPrecio = texto(req.body.unidadPrecio, 20) || "persona";
  if (!nombre || !categoria || !descripcion || !["persona", "grupo"].includes(unidadPrecio) || (req.body.precioUsd && !precio)) {
    return res.status(400).json({ ok: false, error: "Indica nombre, categoría, descripción y un precio válido o déjalo vacío para cotizar." });
  }
  const slug = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    const result = db.prepare(`
      INSERT INTO experiencias (slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio, activa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(slug, nombre, categoria, descripcion, duracion || null, imagen || null, precio, unidadPrecio);
    res.status(201).json({ ok: true, id: result.lastInsertRowid });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ ok: false, error: "Ya existe una experiencia con ese nombre." });
    console.error("Error al crear experiencia:", error);
    res.status(500).json({ ok: false, error: "No se pudo crear la experiencia." });
  }
});

router.get("/informe.xlsx", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "WOPA Travel";
    workbook.created = new Date();

    const reservas = db.prepare(`
      SELECT r.codigo, t.nombre AS hotel, r.nombre, r.correo, r.telefono, r.numero_personas,
        r.fecha_entrada, r.fecha_salida, r.noches, r.subtotal_usd, r.estado,
        COALESCE((SELECT SUM(m.monto_usd) FROM movimientos_financieros m WHERE m.solicitud_reserva_id = r.id AND m.tipo = 'ingreso'), 0) AS abonado_usd,
        r.monto_penalizacion_usd, r.created_at
      FROM solicitudes_reserva r JOIN tipos_habitacion t ON t.id = r.tipo_id
      ORDER BY r.created_at DESC
    `).all();
    const cotizaciones = db.prepare(`
      SELECT c.codigo, c.nombre, c.correo, c.telefono, t.nombre AS hotel, e.nombre AS experiencia,
        c.numero_personas, c.fecha_entrada, c.fecha_salida, c.subtotal_hospedaje_usd,
        c.anticipo_hospedaje_usd, c.subtotal_experiencias_usd, c.unidad_experiencia, c.total_estimado_usd,
        c.cotizacion_completa, c.estado, c.notas, c.created_at
      FROM solicitudes_cotizacion c
      LEFT JOIN tipos_habitacion t ON t.id = c.tipo_id
      LEFT JOIN experiencias e ON e.id = c.experiencia_id
      ORDER BY c.created_at DESC
    `).all();
    const contactos = db.prepare("SELECT codigo, nombre, correo, telefono, asunto, mensaje, estado, nota_admin, created_at FROM mensajes_contacto ORDER BY created_at DESC").all();
    const movimientos = db.prepare(`
      SELECT m.fecha, m.tipo, m.categoria, m.descripcion, m.monto_usd, r.codigo AS reserva_codigo, m.creado_por
      FROM movimientos_financieros m LEFT JOIN solicitudes_reserva r ON r.id = m.solicitud_reserva_id
      ORDER BY m.fecha DESC, m.id DESC
    `).all();
    const ingresos = movimientos.filter((movimiento) => movimiento.tipo === "ingreso").reduce((suma, movimiento) => suma + Number(movimiento.monto_usd), 0);
    const gastos = movimientos.filter((movimiento) => movimiento.tipo === "egreso").reduce((suma, movimiento) => suma + Number(movimiento.monto_usd), 0);
    const penalizaciones = db.prepare("SELECT COALESCE(SUM(monto_penalizacion_usd), 0) AS total FROM solicitudes_reserva WHERE estado = 'cancelada'").get().total;

    const resumen = workbook.addWorksheet("Resumen financiero");
    resumen.addRows([
      ["WOPA Travel · Informe administrativo"],
      ["Generado", new Date().toLocaleString("es-PA")],
      ["Ingresos registrados (USD)", Number(ingresos.toFixed(2))],
      ["Gastos registrados (USD)", Number(gastos.toFixed(2))],
      ["Utilidad neta registrada (USD)", Number((ingresos - gastos).toFixed(2))],
      ["Penalizaciones aplicadas (USD)", Number(Number(penalizaciones).toFixed(2))],
      ["Nota", "La utilidad usa solo movimientos registrados; no sustituye la contabilidad fiscal."],
    ]);
    resumen.getColumn(1).width = 42;
    resumen.getColumn(2).width = 68;
    resumen.getRow(1).font = { bold: true, size: 16, color: { argb: "FF0D3B8F" } };
    for (const [nombre, filas] of [["Reservas", reservas], ["Cotizaciones", cotizaciones], ["Contactos", contactos], ["Movimientos", movimientos]]) {
      const hoja = workbook.addWorksheet(nombre);
      if (filas.length) {
        hoja.columns = Object.keys(filas[0]).map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 5, 16), 34) }));
        hoja.addRows(filas);
        hoja.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D3B8F" } };
        hoja.views = [{ state: "frozen", ySplit: 1 }];
        hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
      } else {
        hoja.addRow(["Sin registros"]);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="wopa-informe-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Error al generar informe Excel:", error);
    res.status(500).json({ ok: false, error: "No se pudo generar el informe Excel." });
  }
});

module.exports = router;
