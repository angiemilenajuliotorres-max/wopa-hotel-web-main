const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Ruta de la base de datos desde la variable de entorno o ruta por defecto
const dbPath = process.env.DB_PATH || path.join(__dirname, "hotel.db");

// Crear directorio si no existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Crear o conectar a la base de datos
const db = new Database(dbPath);

// Habilitar claves foráneas
db.pragma("foreign_keys = ON");

// Inicializar la base de datos si es la primera vez
function inicializarBaseDatos() {
  const schemaPath = path.join(__dirname, "esquema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  // Dividir por punto y coma y ejecutar cada sentencia
  const sentencias = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sentencia of sentencias) {
    db.exec(sentencia);
  }

  console.log("✅ Base de datos inicializada correctamente");
}

// Cargar datos iniciales
function cargarDatosIniciales() {
  // Verificar si ya existen datos
  const stmt = db.prepare("SELECT COUNT(*) as count FROM habitaciones");
  const result = stmt.get();

  if (result.count === 0) {
    const datosPath = path.join(__dirname, "datos_iniciales.sql");
    const datos = fs.readFileSync(datosPath, "utf-8");

    const sentencias = datos
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const sentencia of sentencias) {
      db.exec(sentencia);
    }

    console.log("✅ Datos iniciales cargados correctamente");
  }
}

// Intentar inicializar
try {
  inicializarBaseDatos();
  cargarDatosIniciales();
} catch (error) {
  console.error("Error al inicializar la base de datos:", error.message);
}

module.exports = db;
