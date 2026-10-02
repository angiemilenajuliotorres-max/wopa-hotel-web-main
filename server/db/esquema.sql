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

CREATE TABLE IF NOT EXISTS experiencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  duracion TEXT,
  imagen_url TEXT,
  precio_usd DECIMAL(10, 2),
  unidad_precio TEXT NOT NULL DEFAULT 'persona' CHECK (unidad_precio IN ('persona', 'grupo')),
  activa INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS solicitudes_reserva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  tipo_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL,
  telefono TEXT NOT NULL,
  numero_personas INTEGER NOT NULL,
  fecha_entrada DATE NOT NULL,
  fecha_salida DATE NOT NULL,
  noches INTEGER NOT NULL,
  tarifa_noche_usd DECIMAL(10, 2) NOT NULL,
  subtotal_usd DECIMAL(10, 2) NOT NULL,
  anticipo_usd DECIMAL(10, 2) NOT NULL,
  solicitudes_especiales TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente_confirmacion',
  nota_admin TEXT,
  monto_penalizacion_usd DECIMAL(10, 2) NOT NULL DEFAULT 0,
  fecha_cancelacion DATETIME,
  motivo_cancelacion TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tipo_id) REFERENCES tipos_habitacion(id)
);

CREATE TABLE IF NOT EXISTS solicitudes_cotizacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL,
  telefono TEXT NOT NULL,
  tipo_id INTEGER,
  experiencia_id INTEGER,
  numero_personas INTEGER NOT NULL,
  fecha_entrada DATE,
  fecha_salida DATE,
  notas TEXT,
  subtotal_hospedaje_usd DECIMAL(10, 2),
  anticipo_hospedaje_usd DECIMAL(10, 2),
  subtotal_experiencias_usd DECIMAL(10, 2),
  unidad_experiencia TEXT,
  total_estimado_usd DECIMAL(10, 2),
  cotizacion_completa INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  nota_admin TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tipo_id) REFERENCES tipos_habitacion(id),
  FOREIGN KEY (experiencia_id) REFERENCES experiencias(id)
);

CREATE TABLE IF NOT EXISTS mensajes_contacto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL,
  telefono TEXT,
  asunto TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'nuevo',
  nota_admin TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movimientos_financieros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  categoria TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  monto_usd DECIMAL(12, 2) NOT NULL CHECK (monto_usd > 0),
  solicitud_reserva_id INTEGER,
  fecha DATE NOT NULL DEFAULT (date('now')),
  creado_por TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (solicitud_reserva_id) REFERENCES solicitudes_reserva(id)
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_reserva_fecha ON solicitudes_reserva(fecha_entrada, fecha_salida);
CREATE INDEX IF NOT EXISTS idx_solicitudes_reserva_estado ON solicitudes_reserva(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_cotizacion_estado ON solicitudes_cotizacion(estado);
CREATE INDEX IF NOT EXISTS idx_mensajes_contacto_estado ON mensajes_contacto(estado);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo_fecha ON movimientos_financieros(tipo, fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_reserva ON movimientos_financieros(solicitud_reserva_id);

-- Índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_reservas_hotel ON reservas(hotel_id);
CREATE INDEX IF NOT EXISTS idx_reservas_habitacion ON reservas(habitacion_id);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);
CREATE INDEX IF NOT EXISTS idx_reservas_fechas ON reservas(fecha_entrada, fecha_salida);
CREATE INDEX IF NOT EXISTS idx_habitaciones_hotel ON habitaciones(hotel_id);
CREATE INDEX IF NOT EXISTS idx_tipos_habitacion_hotel ON tipos_habitacion(hotel_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_tipo ON tarifas(tipo_id);
CREATE INDEX IF NOT EXISTS idx_bloqueos_hotel ON bloqueos(hotel_id);
