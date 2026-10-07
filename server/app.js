require("express-async-errors");

const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config();

const db = require("./db/conexion");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

/*
 * IMPORTANTE:
 * En Vercel la base de datos no debe inicializarse
 * en cada petición.
 *
 * La inicialización se hace una vez al cargar la aplicación.
 */
let dbInicializada = false;

const inicializarDB = async () => {
  if (dbInicializada) return;

  await db.inicializarBaseDatos();
  dbInicializada = true;
};

// Middleware para asegurar que la BD esté lista
app.use(async (req, res, next) => {
  try {
    await inicializarDB();
    next();
  } catch (error) {
    console.error("Error inicializando la base de datos:", error);
    res.status(500).json({
      ok: false,
      error: "No se pudo inicializar la base de datos.",
    });
  }
});

/*
 * SEGURIDAD
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

/*
 * CORS
 */
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  })
);

/*
 * RATE LIMIT
 */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      ok: false,
      error: "Demasiadas peticiones. Intenta de nuevo en unos minutos.",
    },
  })
);

/*
 * PARSERS
 */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/*
 * ==========================================
 * HEALTH CHECK
 * ==========================================
 */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "API de WOPA Travel funcionando correctamente",
    app: "WOPA Travel",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/info", (req, res) => {
  res.json({
    ok: true,
    proyecto: "WOPA Travel Web",
    pais: "Panamá",
    provincia: "Chiriquí",
    direccion:
      "Tierras Altas, Provincia de Chiriquí, República de Panamá",
    ciudad_hospedajes: "Cartagena de Indias, Colombia",
    marca: "WOPA Travel",
    version: "1.0.0",
    descripcion:
      "Agencia de viajes WOPA Travel - Viajes a Cartagena con hoteles aliados",
    politica_cancelacion: {
      anticipo: "25%",
      penalizacion: "100% de lo abonado por cancelación",
    },
  });
});

/*
 * ==========================================
 * ROUTERS
 * ==========================================
 */

const habitacionesRouter = require("./rutas/habitaciones");
const solicitudesRouter = require("./rutas/solicitudes");
const adminRouter = require("./rutas/admin");

console.log("ADMIN ROUTER CARGADO:", typeof adminRouter);

/*
 * Habitaciones
 */
app.use("/api/habitaciones", habitacionesRouter);

/*
 * Solicitudes
 */
app.use("/api", solicitudesRouter);

/*
 * ADMIN
 *
 * IMPORTANTE:
 * Solo se monta UNA vez.
 */
app.use("/api/admin", adminRouter);

/*
 * ==========================================
 * PRUEBA ADMIN
 * ==========================================
 *
 * Esta ruta NO requiere contraseña.
 * Sirve para comprobar que Vercel está llegando
 * correctamente al router /api/admin.
 */

app.get("/api/admin-test", (req, res) => {
  res.json({
    ok: true,
    mensaje: "La API de administración está funcionando.",
    ruta: "/api/admin-test",
  });
});

app.get("/api/admin/test-directo", (req, res) => {
  res.json({
    ok: true,
    mensaje: "La ruta directa de admin funciona.",
  });
});

/*
 * ==========================================
 * ARCHIVOS DEL FRONTEND
 * ==========================================
 */

app.use(express.static(path.join(__dirname, "../public")));

/*
 * ADMIN.HTML
 *
 * Permitimos ambas direcciones:
 *
 * /admin
 * /admin.html
 */

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

/*
 * ==========================================
 * SPA
 * ==========================================
 */

app.get("*", (req, res, next) => {
  /*
   * Nunca mandar las rutas API al index.html.
   */
  if (req.path.startsWith("/api/")) {
    return next();
  }

  /*
   * Si existe una página específica,
   * Express static ya la habrá servido.
   */

  res.sendFile(path.join(__dirname, "../public/index.html"));
});

/*
 * ==========================================
 * MANEJO DE ERRORES
 * ==========================================
 */

app.use((err, req, res, next) => {
  console.error("Error en el servidor:", err);

  res.status(err.status || 500).json({
    ok: false,
    error:
      err.status === 404
        ? "Ruta no encontrada."
        : "Ha ocurrido un error interno. Intenta más tarde.",
    timestamp: new Date().toISOString(),
  });
});

/*
 * ==========================================
 * SERVIDOR LOCAL
 * ==========================================
 */

if (require.main === module) {
  inicializarDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(
          `✅ Servidor WOPA Travel corriendo en http://localhost:${PORT}`
        );

        console.log(
          `📍 Ambiente: ${process.env.NODE_ENV || "development"}`
        );

        console.log(
          `🏨 Base de datos: ${
            db.esPostgres
              ? "Neon PostgreSQL"
              : process.env.DB_PATH || "./server/db/hotel.db"
          }`
        );
      });
    })
    .catch((error) => {
      console.error(
        "No se pudo inicializar la base de datos.",
        error.message
      );

      process.exitCode = 1;
    });
}

/*
 * MUY IMPORTANTE PARA VERCEL
 */
module.exports = app;
