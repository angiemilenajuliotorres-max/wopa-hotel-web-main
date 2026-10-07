const crypto = require("crypto");
const express = require("express");
const PDFDocument = require("pdfkit");
const db = require("../db/conexion");
const registrarActividad = require("../db/actividad");

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
  return `${prefijo}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

function errorValidacion(res, mensaje) {
  return res.status(400).json({ ok: false, error: mensaje });
}

router.get("/experiencias", (req, res) => {
  try {
    const experiencias = db.prepare(`
      SELECT id, slug, nombre, categoria, descripcion, duracion, imagen_url, precio_usd, unidad_precio
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

router.get("/cotizaciones/:codigo/pdf", (req, res) => {
  const codigoCotizacion = texto(req.params.codigo, 32).toUpperCase();
  if (!/^WOPA-C-[A-F0-9]{16}$/.test(codigoCotizacion)) {
    return res.status(404).json({ ok: false, error: "No encontramos esa cotización." });
  }

  try {
    const cotizacion = db.prepare(`
      SELECT c.codigo, c.nombre, c.correo, c.telefono, c.numero_personas,
        c.fecha_entrada, c.fecha_salida, c.notas, c.subtotal_hospedaje_usd,
        c.anticipo_hospedaje_usd, c.subtotal_experiencias_usd, c.unidad_experiencia, c.total_estimado_usd,
        c.cotizacion_completa, c.estado, c.created_at,
        t.nombre AS hotel, e.nombre AS experiencia
      FROM solicitudes_cotizacion c
      LEFT JOIN tipos_habitacion t ON t.id = c.tipo_id
      LEFT JOIN experiencias e ON e.id = c.experiencia_id
      WHERE c.codigo = ?
    `).get(codigoCotizacion);

    if (!cotizacion) return res.status(404).json({ ok: false, error: "No encontramos esa cotización." });

    const filename = `wopa-cotizacion-${cotizacion.codigo.toLowerCase()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const pdf = new PDFDocument({ size: "A4", margin: 54, info: { Title: `Cotización WOPA Travel ${cotizacion.codigo}`, Author: "WOPA Travel" } });
    pdf.on("error", (error) => {
      console.error("Error al generar PDF de cotización:", error);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(error);
    });
    pdf.pipe(res);

    const verde = "147B68";
    pdf.font("Helvetica-Bold").fontSize(25).fillColor("0D3B8F").text("wopa", { continued: true });
    pdf.fillColor("DF4C91").text(" Travel");
    pdf.moveDown(0.35);
    pdf.font("Helvetica").fontSize(9).fillColor("62737A").text("AGENCIA DE VIAJES · PANAMÁ");
    pdf.moveDown(1.5);
    pdf.font("Helvetica-Bold").fontSize(21).fillColor("172C32").text(cotizacion.cotizacion_completa ? "Cotización automática" : "Estimado automático parcial");
    pdf.moveDown(0.35);
    pdf.font("Helvetica").fontSize(10).fillColor("62737A").text(`Código: ${cotizacion.codigo}    Estado: ${cotizacion.estado.replaceAll("_", " ")}`);
    pdf.text(`Solicitada: ${cotizacion.created_at}`);
    pdf.moveDown(1.2);

    const seccion = (titulo) => {
      pdf.font("Helvetica-Bold").fontSize(12).fillColor(verde).text(titulo);
      pdf.moveDown(0.45);
    };
    const fila = (etiqueta, valor) => {
      pdf.font("Helvetica-Bold").fontSize(10).fillColor("172C32").text(`${etiqueta}: `, { continued: true });
      pdf.font("Helvetica").fillColor("34494F").text(String(valor || "Por definir"));
      pdf.moveDown(0.4);
    };

    seccion("Datos del viajero");
    fila("Nombre", cotizacion.nombre);
    fila("Correo", cotizacion.correo);
    fila("Teléfono", cotizacion.telefono);
    fila("Viajeros", cotizacion.numero_personas);
    pdf.moveDown(0.5);

    seccion("Opciones solicitadas");
    fila("Hotel aliado", cotizacion.hotel || "No solicitado");
    fila("Experiencia / tour", cotizacion.experiencia || "No solicitado");
    fila("Entrada", cotizacion.fecha_entrada || "Por definir");
    fila("Salida", cotizacion.fecha_salida || "Por definir");
    if (cotizacion.notas) fila("Preferencias", cotizacion.notas);
    pdf.moveDown(0.5);

    seccion("Desglose automático");
    if (cotizacion.subtotal_hospedaje_usd !== null) {
      pdf.font("Helvetica").fontSize(10).fillColor("34494F").text(`Hospedaje estimado: ${Number(cotizacion.subtotal_hospedaje_usd).toFixed(2)} USD`);
      pdf.text(`Anticipo estimado (25% del hospedaje): ${Number(cotizacion.anticipo_hospedaje_usd).toFixed(2)} USD`);
    } else {
      pdf.font("Helvetica").fontSize(10).fillColor("34494F").text("Hospedaje: no solicitado.");
    }
    if (cotizacion.experiencia && cotizacion.subtotal_experiencias_usd !== null) {
      pdf.text(`Experiencia (${cotizacion.unidad_experiencia === "persona" ? "por persona" : "precio por grupo"}): ${Number(cotizacion.subtotal_experiencias_usd).toFixed(2)} USD`);
    } else if (cotizacion.experiencia) {
      pdf.text("Experiencia: precio pendiente de publicar; no incluido en el estimado.");
    }
    if (cotizacion.total_estimado_usd !== null) {
      pdf.moveDown(0.4);
      pdf.font("Helvetica-Bold").fontSize(13).fillColor("147B68").text(`${cotizacion.cotizacion_completa ? "Total estimado" : "Subtotal estimado (sin componentes pendientes)"}: ${Number(cotizacion.total_estimado_usd).toFixed(2)} USD`);
    }
    pdf.moveDown(1.2);

    pdf.roundedRect(54, pdf.y, 487, 93, 6).fill("F2F6F5");
    pdf.fillColor("172C32").font("Helvetica-Bold").fontSize(10).text("Importante", 68, pdf.y + 13, { lineBreak: false });
    pdf.font("Helvetica").fontSize(9).fillColor("455A5F").text(
      "Cotización calculada automáticamente con las tarifas cargadas. Si es parcial, los productos sin precio publicado no están incluidos. No confirma disponibilidad ni reserva de hospedaje; esta se confirma al solicitar la reserva.",
      68,
      pdf.y + 31,
      { width: 457, height: 55, lineGap: 2 },
    );
    pdf.moveDown(5.5);
    pdf.font("Helvetica-Bold").fontSize(9).fillColor("0D3B8F").text("WOPA Travel · Tierras Altas, Chiriquí, Panamá");
    pdf.font("Helvetica").fontSize(9).fillColor("62737A").text("wondersofpty@gmail.com · +507 6286-9154");
    pdf.end();
  } catch (error) {
    console.error("Error al consultar cotización para PDF:", error);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "No se pudo generar el PDF de la cotización." });
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
    const guardarReserva = db.transaction(() => {
      db.prepare(`
      INSERT INTO solicitudes_reserva (
        codigo, tipo_id, nombre, correo, telefono, numero_personas,
        fecha_entrada, fecha_salida, noches, tarifa_noche_usd,
        subtotal_usd, anticipo_usd, solicitudes_especiales
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reservaCodigo, tipoId, nombre, correo, telefono, personas, entrada, salida, noches,
        tarifa.precio_usd, total, anticipo, especiales || null);
      registrarActividad({
        tipoEvento: "reserva_solicitada", entidad: "reserva", codigoEntidad: reservaCodigo,
        detalle: `Solicitud recibida para ${aliado.nombre}.`, estadoNuevo: "pendiente_confirmacion", montoUsd: total,
      });
    });
    guardarReserva();

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
    let totalExperiencias = null;
    let totalEstimado = 0;
    let cotizacionCompleta = true;
    const conceptosPendientes = [];
    if (tipoId) {
      const aliado = db.prepare("SELECT id, nombre, capacidad_maxima FROM tipos_habitacion WHERE id = ?").get(tipoId);
      if (!aliado || personas > aliado.capacidad_maxima) return errorValidacion(res, "Revisa el hotel aliado y la cantidad de personas.");
      const tarifa = db.prepare(`
        SELECT precio_usd FROM tarifas
        WHERE tipo_id = ? AND capacidad_personas = ?
        ORDER BY CASE temporada WHEN 'baja' THEN 0 ELSE 1 END LIMIT 1
      `).get(tipoId, personas <= 2 ? 2 : 4);
      if (!tarifa) return errorValidacion(res, "No hay tarifa publicada para ese grupo; contáctanos para una cotización personalizada.");
      totalHospedaje = Math.round(Number(tarifa.precio_usd) * nochesEntre(entrada, salida) * 100) / 100;
      anticipoHospedaje = Math.round(totalHospedaje * 25) / 100;
      totalEstimado += totalHospedaje;
    }
    let experiencia = null;
    if (experienciaId) {
      experiencia = db.prepare(`
        SELECT id, nombre, precio_usd, unidad_precio
        FROM experiencias
        WHERE id = ? AND activa = 1
      `).get(experienciaId);
      if (!experiencia) return errorValidacion(res, "La experiencia seleccionada ya no está disponible para cotizar.");
      if (experiencia.precio_usd === null) {
        cotizacionCompleta = false;
        conceptosPendientes.push(`tour: ${experiencia.nombre}`);
      } else {
        const multiplicador = experiencia.unidad_precio === "persona" ? personas : 1;
        totalExperiencias = Math.round(Number(experiencia.precio_usd) * multiplicador * 100) / 100;
        totalEstimado += totalExperiencias;
      }
    }

    const totalEstimadoGuardado = totalHospedaje !== null || totalExperiencias !== null
      ? Math.round(totalEstimado * 100) / 100
      : null;
    const estadoCotizacion = cotizacionCompleta ? "generada_automatica" : "estimado_parcial";
    const cotizacionCodigo = codigo("WOPA-C");
    db.transaction(() => {
      db.prepare(`
      INSERT INTO solicitudes_cotizacion (
        codigo, nombre, correo, telefono, tipo_id, experiencia_id, numero_personas,
        fecha_entrada, fecha_salida, notas, subtotal_hospedaje_usd, anticipo_hospedaje_usd,
        subtotal_experiencias_usd, unidad_experiencia, total_estimado_usd, cotizacion_completa, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cotizacionCodigo, nombre, correo, telefono, tipoId, experienciaId, personas,
        entrada || null, salida || null, notas || null, totalHospedaje, anticipoHospedaje,
        totalExperiencias, experiencia?.unidad_precio || null, totalEstimadoGuardado, cotizacionCompleta ? 1 : 0, estadoCotizacion);
      registrarActividad({
        tipoEvento: "cotizacion_solicitada", entidad: "cotizacion", codigoEntidad: cotizacionCodigo,
        detalle: "Solicitud de cotización recibida.", estadoNuevo: estadoCotizacion, montoUsd: totalEstimadoGuardado,
      });
    })();

    res.status(201).json({
      ok: true,
      codigo: cotizacionCodigo,
      estado: estadoCotizacion,
      cotizacionCompleta,
      conceptosPendientes,
      mensaje: cotizacionCompleta
        ? "Tu cotización automática está lista con las tarifas cargadas en el catálogo. La disponibilidad del hospedaje se confirma al solicitar la reserva."
        : "Generamos automáticamente el estimado con los precios disponibles. Los productos sin tarifa publicada no se incluyen en el total.",
      resumen: {
        hospedajeEstimadoUsd: totalHospedaje,
        experienciasEstimadasUsd: totalExperiencias,
        totalEstimadoUsd: totalEstimadoGuardado,
        anticipoHospedajeEstimadoUsd: anticipoHospedaje,
      },
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
    db.transaction(() => {
      db.prepare(`
      INSERT INTO mensajes_contacto (codigo, nombre, correo, telefono, asunto, mensaje)
      VALUES (?, ?, ?, ?, ?, ?)
      `).run(contactoCodigo, nombre, correo, telefono || null, asunto, mensaje);
      registrarActividad({
        tipoEvento: "mensaje_recibido", entidad: "contacto", codigoEntidad: contactoCodigo,
        detalle: `Mensaje recibido: ${asunto}.`, estadoNuevo: "nuevo",
      });
    })();
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
