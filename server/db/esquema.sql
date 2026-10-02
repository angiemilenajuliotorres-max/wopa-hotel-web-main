-- Tabla de hoteles
CREATE TABLE IF NOT EXISTS hoteles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  direccion TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  pais TEXT NOT NULL,
  rnt TEXT,
  telefono TEXT,
  correo TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de tipos de habitación
CREATE TABLE IF NOT EXISTS tipos_habitacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  capacidad_minima INTEGER DEFAULT 1,
  capacidad_maxima INTEGER DEFAULT 4,
  servicios TEXT,
  imagen_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE,
  UNIQUE(hotel_id, nombre)
);

-- Tabla de habitaciones
CREATE TABLE IF NOT EXISTS habitaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  tipo_id INTEGER NOT NULL,
  numero TEXT NOT NULL,
  piso INTEGER,
  descripcion TEXT,
  estado TEXT DEFAULT 'disponible',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE,
  FOREIGN KEY (tipo_id) REFERENCES tipos_habitacion(id) ON DELETE CASCADE,
  UNIQUE(hotel_id, numero)
);

-- Tabla de tarifas
CREATE TABLE IF NOT EXISTS tarifas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_id INTEGER NOT NULL,
  capacidad_personas INTEGER NOT NULL,
  precio_usd DECIMAL(10, 2) NOT NULL,
  temporada TEXT DEFAULT 'baja',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tipo_id) REFERENCES tipos_habitacion(id) ON DELETE CASCADE,
  UNIQUE(tipo_id, capacidad_personas, temporada)
);

-- Tabla de reservas
CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_reserva TEXT NOT NULL UNIQUE,
  habitacion_id INTEGER NOT NULL,
  hotel_id INTEGER NOT NULL,
  nombre_huesped TEXT NOT NULL,
  correo_huesped TEXT NOT NULL,
  telefono_huesped TEXT NOT NULL,
  pais_huesped TEXT,
  numero_personas INTEGER NOT NULL,
  fecha_entrada DATE NOT NULL,
  fecha_salida DATE NOT NULL,
  numero_noches INTEGER,
  solicitudes_especiales TEXT,
  hora_llegada_estimada TEXT,
  subtotal_usd DECIMAL(10, 2),
  impuesto_usd DECIMAL(10, 2),
  total_usd DECIMAL(10, 2),
  total_cop DECIMAL(12, 2),
  estado TEXT DEFAULT 'pendiente',
  referencia_pago TEXT,
  fecha_pago DATETIME,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_expiracion_pago DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id),
  FOREIGN KEY (hotel_id) REFERENCES hoteles(id)
);

-- Tabla de bloqueos manuales (para cerrar fechas sin reserva)
CREATE TABLE IF NOT EXISTS bloqueos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  razon TEXT,
  creado_por TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hoteles(id) ON DELETE CASCADE
);

-- Índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_reservas_hotel ON reservas(hotel_id);
CREATE INDEX IF NOT EXISTS idx_reservas_habitacion ON reservas(habitacion_id);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);
CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(fecha_entrada, fecha_salida);
CREATE INDEX IF NOT EXISTS idx_habitaciones_hotel ON habitaciones(hotel_id);
CREATE INDEX IF NOT EXISTS idx_tipos_habitacion_hotel ON tipos_habitacion(hotel_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_tipo ON tarifas(tipo_id);
CREATE INDEX IF NOT EXISTS idx_bloqueos_hotel ON bloqueos(hotel_id);
