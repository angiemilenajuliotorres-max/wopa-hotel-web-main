const express = require("express");
const db = require("../db/conexion");

const router = express.Router();

// GET /api/habitaciones - Obtener todos los tipos de habitación con tarifas
router.get("/", async (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT 
        th.id,
        th.nombre,
        th.descripcion,
        th.capacidad_minima,
        th.capacidad_maxima,
        th.servicios,
        th.imagen_url,
        t.capacidad_personas,
        t.precio_usd,
        t.temporada
      FROM tipos_habitacion th
      LEFT JOIN tarifas t ON th.id = t.tipo_id
      ORDER BY th.nombre ASC, t.capacidad_personas ASC
    `);

    const hotelesAliados = new Map();
    for (const fila of await stmt.all()) {
      if (!hotelesAliados.has(fila.id)) {
        hotelesAliados.set(fila.id, {
          id: fila.id,
          nombre: fila.nombre,
          descripcion: fila.descripcion,
          capacidad_minima: fila.capacidad_minima,
          capacidad_maxima: fila.capacidad_maxima,
          servicios: fila.servicios,
          imagen_url: fila.imagen_url,
          tarifas: [],
        });
      }

      if (fila.capacidad_personas !== null) {
        hotelesAliados.get(fila.id).tarifas.push({
          capacidad: fila.capacidad_personas,
          precio_usd: fila.precio_usd,
          temporada: fila.temporada,
        });
      }
    }

    res.json({
      ok: true,
      data: [...hotelesAliados.values()],
    });
  } catch (error) {
    console.error("Error al obtener habitaciones:", error);
    res.status(500).json({
      ok: false,
      error: "Error al obtener habitaciones",
    });
  }
});

// GET /api/habitaciones/:id - Obtener detalle de una habitación específica
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const stmt = db.prepare(`
      SELECT 
        th.id,
        th.nombre,
        th.descripcion,
        th.capacidad_minima,
        th.capacidad_maxima,
        th.servicios,
        th.imagen_url,
        t.capacidad_personas,
        t.precio_usd,
        t.temporada
      FROM tipos_habitacion th
      LEFT JOIN tarifas t ON th.id = t.tipo_id
      WHERE th.id = ?
      ORDER BY t.capacidad_personas ASC
    `);

    const filas = await stmt.all(id);
    const habitacion = filas[0] && {
      ...filas[0],
      tarifas: filas.filter((fila) => fila.capacidad_personas !== null).map((fila) => ({
        capacidad: fila.capacidad_personas,
        precio_usd: fila.precio_usd,
        temporada: fila.temporada,
      })),
    };

    if (!habitacion) {
      return res.status(404).json({
        ok: false,
        error: "Habitación no encontrada",
      });
    }

    res.json({
      ok: true,
      data: habitacion,
    });
  } catch (error) {
    console.error("Error al obtener habitación:", error);
    res.status(500).json({
      ok: false,
      error: "Error al obtener habitación",
    });
  }
});

// POST /api/habitaciones/disponibilidad - Desactivado
// Consultaba reservas.tipo_id, columna que no existe, y la tabla reservas nunca
// recibe datos. La disponibilidad real llega con tarifas.cupos_dia (fase 2).
router.post("/disponibilidad", (req, res) => {
  res.status(410).json({
    ok: false,
    error: "La consulta de disponibilidad no está disponible. Envía una solicitud de reserva y WOPA Travel confirmará la disponibilidad.",
  });
});

module.exports = router;
