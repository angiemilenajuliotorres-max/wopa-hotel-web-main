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

  const asegurarColumna = (tabla, columna, definicion) => {
    const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all();
    if (!columnas.some((item) => item.name === columna)) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    }
  };

  asegurarColumna("solicitudes_reserva", "nota_admin", "TEXT");
  asegurarColumna("solicitudes_reserva", "monto_penalizacion_usd", "DECIMAL(10, 2) NOT NULL DEFAULT 0");
  asegurarColumna("solicitudes_reserva", "fecha_cancelacion", "DATETIME");
  asegurarColumna("solicitudes_reserva", "motivo_cancelacion", "TEXT");
  asegurarColumna("solicitudes_cotizacion", "nota_admin", "TEXT");
  asegurarColumna("solicitudes_cotizacion", "subtotal_experiencias_usd", "DECIMAL(10, 2)");
  asegurarColumna("solicitudes_cotizacion", "unidad_experiencia", "TEXT");
  asegurarColumna("solicitudes_cotizacion", "total_estimado_usd", "DECIMAL(10, 2)");
  asegurarColumna("solicitudes_cotizacion", "cotizacion_completa", "INTEGER NOT NULL DEFAULT 0");
  asegurarColumna("experiencias", "unidad_precio", "TEXT NOT NULL DEFAULT 'persona'");
  asegurarColumna("mensajes_contacto", "nota_admin", "TEXT");

  db.prepare(`
    UPDATE hoteles
    SET correo = ?
    WHERE slug = 'wopa-travel-cartagena'
  `).run("wondersofpty@gmail.com");

  console.log("✅ Base de datos inicializada correctamente");
}

// Cargar datos iniciales
function cargarDatosIniciales() {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM tipos_habitacion");
  const result = stmt.get();

  if (result.count === 0) {
    const datosPath = path.join(__dirname, "datos_iniciales.sql");
    const datos = fs.readFileSync(datosPath, "utf-8");

    const sentencias = datos
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const cargar = db.transaction(() => {
      for (const sentencia of sentencias) db.exec(sentencia);
    });
    cargar();

    console.log("✅ Datos iniciales cargados correctamente");
  }

  const experienciasPath = path.join(__dirname, "experiencias_iniciales.sql");
  if (fs.existsSync(experienciasPath)) {
    db.exec(fs.readFileSync(experienciasPath, "utf-8"));
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
