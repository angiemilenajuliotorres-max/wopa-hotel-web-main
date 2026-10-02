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
    message: "API de OPPA funcionando correctamente",
    app: "OPPA Hotel",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/info", (req, res) => {
  res.json({
    ok: true,
    proyecto: "OPPA Hotel Web",
    pais: "Panamá",
    ciudad_hospedajes: "Cartagena de Indias",
    marca: "OPPA",
    version: "1.0.0",
    descripcion: "Agencia de viajes OPPA - Reservas de hospedajes en Cartagena",
  });
});

// Rutas de API
const habitacionesRouter = require("./rutas/habitaciones");

app.use("/api/habitaciones", habitacionesRouter);

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, "../public")));

// SPA - Redirigir todas las rutas no API a index.html
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor OPPA corriendo en http://localhost:${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log(`🏨 Base de datos: ${process.env.DB_PATH || "./server/db/hotel.db"}`);
});
