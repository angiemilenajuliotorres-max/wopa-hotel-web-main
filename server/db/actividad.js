const db = require("./conexion");

function registrarActividad({
  tipoEvento,
  entidad,
  codigoEntidad = null,
  detalle = null,
  estadoAnterior = null,
  estadoNuevo = null,
  montoUsd = null,
  realizadoPor = "sitio web",
}) {
  db.prepare(`
    INSERT INTO actividad_sitio (
      tipo_evento, entidad, codigo_entidad, detalle, estado_anterior,
      estado_nuevo, monto_usd, realizado_por
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tipoEvento, entidad, codigoEntidad, detalle, estadoAnterior, estadoNuevo, montoUsd, realizadoPor);
}

module.exports = registrarActividad;