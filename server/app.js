require("express-async-errors");
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

// Cargar variables de entorno
dotenv.config();

// Inicializar base de datos
const db = require("./db/conexion");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

app.use((req, res, next) => {
  db.inicializarBaseDatos().then(() => next(), next);
});

// Middleware de seguridad
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  })
);

// Rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // límite de 100 peticiones por ventana
    message: {
      ok: false,
      error: "Demasiadas peticiones. Intenta de nuevo en unos minutos.",
    },
  })
);

// Parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Rutas de health check
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
    direccion: "Tierras Altas, Provincia de Chiriquí, República de Panamá",
    ciudad_hospedajes: "Cartagena de Indias, Colombia",
    marca: "WOPA Travel",
    version: "1.0.0",
    descripcion: "Agencia de viajes WOPA Travel - Viajes a Cartagena con hoteles aliados",
    politica_cancelacion: {
      anticipo: "25%",
      penalizacion: "100% de lo abonado por cancelación",
    },
  });
});

// Rutas de API
const habitacionesRouter = require("./rutas/habitaciones");
const solicitudesRouter = require("./rutas/solicitudes");
const adminRouter = require("./rutas/admin");
app.get("/api/admin/test", (req, res) => {
  res.json({ ok: true, mensaje: "ADMIN funciona" });
});


app.use("/api/habitaciones", habitacionesRouter);
app.use("/api", solicitudesRouter);
app.get("/api/admin-prueba", (req, res) => {
  res.json({
    ok: true,
    mensaje: "La ruta API admin funciona directamente desde app.js"
  });
});

app.use("/api/admin", adminRouter);

app.use("/api/admin", adminRouter);

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, "../public")));

// SPA - Redirigir todas las rutas no API a index.html
// Páginas del sitio
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/admin.html"));
});

// SPA - Rutas del sitio público
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }

  res.sendFile(path.join(__dirname, "../public/index.html"));
});


// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error("Error en el servidor:", err);

  res.status(500).json({
    ok: false,
    error: "Ha ocurrido un error interno. Intenta más tarde.",
    timestamp: new Date().toISOString(),
  });
});

if (require.main === module) {
  db.inicializarBaseDatos().then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor WOPA Travel corriendo en http://localhost:${PORT}`);
      console.log(`📍 Ambiente: ${process.env.NODE_ENV || "development"}`);
      console.log(`🏨 Base de datos: ${db.esPostgres ? "Neon PostgreSQL" : (process.env.DB_PATH || "./server/db/hotel.db")}`);
    });
  }).catch((error) => {
    console.error("No se pudo inicializar la base de datos.", error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
