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

// POST /api/habitaciones/disponibilidad - Verificar disponibilidad
// Body esperado: { fechaEntrada: "YYYY-MM-DD", fechaSalida: "YYYY-MM-DD", numeroPeople: 2 }
router.post("/disponibilidad", async (req, res) => {
  try {
    const { fechaEntrada, fechaSalida, numeroPersonas } = req.body;

    // Validar entrada
    if (!fechaEntrada || !fechaSalida || !numeroPersonas) {
      return res.status(400).json({
        ok: false,
        error: "Faltan parámetros: fechaEntrada, fechaSalida, numeroPersonas",
      });
    }

    // Validar que la entrada sea menor que la salida
    if (new Date(fechaEntrada) >= new Date(fechaSalida)) {
      return res.status(400).json({
        ok: false,
        error: "La fecha de entrada debe ser anterior a la de salida",
      });
    }

    // Validar que no sean fechas pasadas
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const entrada = new Date(fechaEntrada);
    entrada.setHours(0, 0, 0, 0);

    if (entrada < hoy) {
      return res.status(400).json({
        ok: false,
        error: "No se pueden reservar fechas pasadas",
      });
    }

    // Determinar el grupo de tarifa según número de personas
    const grupoCapacidad = numeroPersonas <= 2 ? 2 : 4;

    // Buscar habitaciones disponibles
    const stmt = db.prepare(`
      SELECT 
        th.id,
        th.nombre,
        th.descripcion,
        th.capacidad_maxima,
        th.servicios,
        th.imagen_url,
        t.precio_usd,
        t.temporada
      FROM tipos_habitacion th
      LEFT JOIN tarifas t ON th.id = t.tipo_id AND t.capacidad_personas = ?
      WHERE th.capacidad_maxima >= ?
        AND th.id NOT IN (
          SELECT DISTINCT r.tipo_id
          FROM reservas r
          WHERE r.estado IN ('pendiente', 'pagada')
            AND r.fecha_entrada < ?
            AND r.fecha_salida > ?
        )
      ORDER BY t.precio_usd ASC
    `);

    const disponibles = await stmt.all(grupoCapacidad, numeroPersonas, fechaSalida, fechaEntrada);

    if (disponibles.length === 0) {
      return res.json({
        ok: true,
        disponible: false,
        mensaje: "No hay habitaciones disponibles para esas fechas",
        data: [],
      });
    }

    res.json({
      ok: true,
      disponible: true,
      data: disponibles,
    });
  } catch (error) {
    console.error("Error al verificar disponibilidad:", error);
    res.status(500).json({
      ok: false,
      error: "Error al verificar disponibilidad",
    });
  }
});

module.exports = router;
