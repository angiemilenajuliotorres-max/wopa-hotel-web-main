const crypto = require("crypto");
const express = require("express");
const db = require("../db/conexion");

const router = express.Router();

function texto(valor, maximo = 500) {
  return typeof valor === "string" ? valor.trim().slice(0, maximo) : "";
}

function correoValido(valor) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

function fechaValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || "")) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.valueOf()) && fecha.toISOString().slice(0, 10) === valor;
}

function fechasDeViajeValidas(entrada, salida) {
  return fechaValida(entrada) && fechaValida(salida) && entrada < salida;
}

function nochesEntre(entrada, salida) {
  return Math.round((Date.parse(`${salida}T00:00:00Z`) - Date.parse(`${entrada}T00:00:00Z`)) / 86400000);
}

function codigo(prefijo) {
  return `${prefijo}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function errorValidacion(res, mensaje) {
  return res.status(400).json({ ok: false, error: mensaje });
}

router.get("/experiencias", (req, res) => {
  try {
    const experiencias = db.prepare(`
      SELECT id, slug, nombre, categoria, descripcion, duracion, imagen_url
      FROM experiencias
      WHERE activa = 1
      ORDER BY id
    `).all();
    res.json({ ok: true, data: experiencias });
  } catch (error) {
    console.error("Error al consultar experiencias:", error);
    res.status(500).json({ ok: false, error: "No se pudieron consultar las experiencias." });
  }
});

router.post("/reservas", (req, res) => {
  const nombre = texto(req.body.nombre, 120);
  const correo = texto(req.body.correo, 160).toLowerCase();
  const telefono = texto(req.body.telefono, 40);
  const tipoId = Number(req.body.tipoId);
  const personas = Number(req.body.numeroPersonas);
  const entrada = texto(req.body.fechaEntrada, 10);
  const salida = texto(req.body.fechaSalida, 10);
  const especiales = texto(req.body.solicitudesEspeciales, 1000);

  if (!nombre || !correoValido(correo) || !telefono || !Number.isInteger(tipoId) || !Number.isInteger(personas)) {
    return errorValidacion(res, "Completa nombre, correo, teléfono, hotel y número de personas.");
  }
  if (!fechasDeViajeValidas(entrada, salida) || entrada < new Date().toISOString().slice(0, 10)) {
    return errorValidacion(res, "Indica fechas válidas futuras; la salida debe ser posterior a la entrada.");
  }
  if (personas < 1 || personas > 4) {
    return errorValidacion(res, "Las tarifas publicadas aplican para grupos de 1 a 4 personas.");
  }

  try {
    const aliado = db.prepare(`
      SELECT th.id, th.nombre, th.capacidad_maxima
      FROM tipos_habitacion th
      WHERE th.id = ?
    `).get(tipoId);
    if (!aliado || personas > aliado.capacidad_maxima) {
      return errorValidacion(res, "El hotel aliado seleccionado no admite esa cantidad de personas.");
    }

    const tarifa = db.prepare(`
      SELECT precio_usd FROM tarifas
      WHERE tipo_id = ? AND capacidad_personas = ?
      ORDER BY CASE temporada WHEN 'baja' THEN 0 ELSE 1 END
      LIMIT 1
    `).get(tipoId, personas <= 2 ? 2 : 4);
    if (!tarifa) return errorValidacion(res, "No hay una tarifa publicada para esa opción. Solicita una cotización.");

    const noches = nochesEntre(entrada, salida);
    const total = Math.round(Number(tarifa.precio_usd) * noches * 100) / 100;
    const anticipo = Math.round(total * 25) / 100;
    const reservaCodigo = codigo("WOPA-R");
    db.prepare(`
      INSERT INTO solicitudes_reserva (
        codigo, tipo_id, nombre, correo, telefono, numero_personas,
        fecha_entrada, fecha_salida, noches, tarifa_noche_usd,
        subtotal_usd, anticipo_usd, solicitudes_especiales
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reservaCodigo, tipoId, nombre, correo, telefono, personas, entrada, salida, noches,
      tarifa.precio_usd, total, anticipo, especiales || null);

    res.status(201).json({
      ok: true,
      codigo: reservaCodigo,
      estado: "pendiente_confirmacion",
      mensaje: "Recibimos tu solicitud. WOPA Travel confirmará disponibilidad y tarifa antes de cobrar o confirmar la reserva.",
      resumen: { hotel: aliado.nombre, noches, tarifaNocheUsd: Number(tarifa.precio_usd), subtotalUsd: total, anticipoEstimadoUsd: anticipo },
    });
  } catch (error) {
    console.error("Error al guardar solicitud de reserva:", error);
    res.status(500).json({ ok: false, error: "No se pudo guardar la solicitud de reserva." });
  }
});

router.post("/cotizaciones", (req, res) => {
  const nombre = texto(req.body.nombre, 120);
  const correo = texto(req.body.correo, 160).toLowerCase();
  const telefono = texto(req.body.telefono, 40);
  const tipoId = req.body.tipoId ? Number(req.body.tipoId) : null;
  const experienciaId = req.body.experienciaId ? Number(req.body.experienciaId) : null;
  const personas = Number(req.body.numeroPersonas);
  const entrada = texto(req.body.fechaEntrada, 10);
  const salida = texto(req.body.fechaSalida, 10);
  const notas = texto(req.body.notas, 1500);

  if (!nombre || !correoValido(correo) || !telefono || !Number.isInteger(personas) || personas < 1 || personas > 12) {
    return errorValidacion(res, "Completa tus datos de contacto e indica un grupo de 1 a 12 personas.");
  }
  if (!tipoId && !experienciaId) return errorValidacion(res, "Selecciona un hotel aliado, un tour o ambos para cotizar.");
  if ((entrada || salida) && (!fechasDeViajeValidas(entrada, salida) || entrada < new Date().toISOString().slice(0, 10))) {
    return errorValidacion(res, "Indica fechas válidas futuras; la salida debe ser posterior a la entrada.");
  }
  if (tipoId && (!entrada || !salida)) return errorValidacion(res, "Para cotizar hospedaje necesitamos las fechas de entrada y salida.");

  try {
    let totalHospedaje = null;
    let anticipoHospedaje = null;
    if (tipoId) {
      const aliado = db.prepare("SELECT id, capacidad_maxima FROM tipos_habitacion WHERE id = ?").get(tipoId);
      if (!aliado || personas > aliado.capacidad_maxima) return errorValidacion(res, "Revisa el hotel aliado y la cantidad de personas.");
      const tarifa = db.prepare(`
        SELECT precio_usd FROM tarifas
        WHERE tipo_id = ? AND capacidad_personas = ?
        ORDER BY CASE temporada WHEN 'baja' THEN 0 ELSE 1 END LIMIT 1
      `).get(tipoId, personas <= 2 ? 2 : 4);
      if (!tarifa) return errorValidacion(res, "No hay tarifa publicada para ese grupo; contáctanos para una cotización personalizada.");
      totalHospedaje = Math.round(Number(tarifa.precio_usd) * nochesEntre(entrada, salida) * 100) / 100;
      anticipoHospedaje = Math.round(totalHospedaje * 25) / 100;
    }
    if (experienciaId && !db.prepare("SELECT id FROM experiencias WHERE id = ? AND activa = 1").get(experienciaId)) {
      return errorValidacion(res, "La experiencia seleccionada ya no está disponible para cotizar.");
    }

    const cotizacionCodigo = codigo("WOPA-C");
    db.prepare(`
      INSERT INTO solicitudes_cotizacion (
        codigo, nombre, correo, telefono, tipo_id, experiencia_id, numero_personas,
        fecha_entrada, fecha_salida, notas, subtotal_hospedaje_usd, anticipo_hospedaje_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cotizacionCodigo, nombre, correo, telefono, tipoId, experienciaId, personas,
      entrada || null, salida || null, notas || null, totalHospedaje, anticipoHospedaje);

    res.status(201).json({
      ok: true,
      codigo: cotizacionCodigo,
      estado: "pendiente",
      mensaje: "Recibimos tu solicitud de cotización. Te contactaremos para confirmar servicios, disponibilidad y precios finales.",
      resumen: totalHospedaje === null ? null : { hospedajeEstimadoUsd: totalHospedaje, anticipoHospedajeEstimadoUsd: anticipoHospedaje },
    });
  } catch (error) {
    console.error("Error al guardar solicitud de cotización:", error);
    res.status(500).json({ ok: false, error: "No se pudo guardar la solicitud de cotización." });
  }
});

router.post("/contacto", (req, res) => {
  const nombre = texto(req.body.nombre, 120);
  const correo = texto(req.body.correo, 160).toLowerCase();
  const telefono = texto(req.body.telefono, 40);
  const asunto = texto(req.body.asunto, 160);
  const mensaje = texto(req.body.mensaje, 2000);

  if (!nombre || !correoValido(correo) || !asunto || mensaje.length < 10) {
    return errorValidacion(res, "Indica tu nombre, un correo válido, el asunto y un mensaje de al menos 10 caracteres.");
  }

  try {
    const contactoCodigo = codigo("WOPA-M");
    db.prepare(`
      INSERT INTO mensajes_contacto (codigo, nombre, correo, telefono, asunto, mensaje)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contactoCodigo, nombre, correo, telefono || null, asunto, mensaje);
    res.status(201).json({
      ok: true,
      codigo: contactoCodigo,
      mensaje: "Tu mensaje quedó registrado. El equipo de WOPA Travel se pondrá en contacto contigo.",
    });
  } catch (error) {
    console.error("Error al guardar mensaje de contacto:", error);
    res.status(500).json({ ok: false, error: "No se pudo guardar el mensaje." });
  }
});

module.exports = router;
