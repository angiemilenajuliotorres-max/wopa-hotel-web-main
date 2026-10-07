const catalogo = document.getElementById("habitaciones-list");
let hotelesAliados = [];

const imagenesPorHotel = {
  "Hotel La Casona de Getsemaní": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
  "Hotel Marina Suites by GEH Suites": "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=80",
  "Hotel Dorado Centro Histórico": "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?auto=format&fit=crop&w=1200&q=80",
  "Wala Hotel and Beach Club Bocagrande": "https://images.unsplash.com/photo-1493558103817-58b2924b5713?auto=format&fit=crop&w=1200&q=80",
  "Mintaka Hotel and Lounge": "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
  "Hotel Aixo Suites by GEH Suites": "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
  "Hotel Atlantic Luc": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  "Hotel Regatta": "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
};

function textoCatalogo(clave, respaldo) {
  return window.obtenerTexto?.(`catalogo.${clave}`) || respaldo;
}

function mostrarEstadoCatalogo(clave, respaldo) {
  const mensaje = document.createElement("p");
  mensaje.className = "catalogo-estado";
  mensaje.setAttribute("role", "status");
  mensaje.textContent = textoCatalogo(clave, respaldo);
  catalogo.replaceChildren(mensaje);
}

function crearTexto(tag, className, contenido) {
  const elemento = document.createElement(tag);
  elemento.className = className;
  elemento.textContent = contenido;
  return elemento;
}

function crearTarjeta(hotel) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "habitacion-card";

  const imagen = document.createElement("img");
  imagen.className = "habitacion-card-image";
  imagen.src = hotel.imagen_url || imagenesPorHotel[hotel.nombre] ||
    "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=900&q=80";
  imagen.alt = hotel.nombre;
  imagen.loading = "lazy";
  tarjeta.append(imagen);

  const contenido = document.createElement("div");
  contenido.className = "habitacion-card-content";
  contenido.append(crearTexto("h3", "habitacion-card-title", hotel.nombre));

  if (hotel.descripcion) {
    contenido.append(crearTexto("p", "habitacion-card-descripcion", hotel.descripcion));
  }

  const tarifas = [...(hotel.tarifas || [])].sort((a, b) => a.capacidad - b.capacidad);
  if (tarifas.length) {
    const etiquetaCapacidad = (capacidad) => capacidad <= 2
      ? textoCatalogo("precio12", "1-2 personas")
      : textoCatalogo("precio34", "3-4 personas");

    for (const tarifa of tarifas) {
      const precio = new Intl.NumberFormat(
        localStorage.getItem("idioma") === "en" ? "en-US" : "es-PA",
        { maximumFractionDigits: 0 },
      ).format(Number(tarifa.precio_usd));
      const linea = document.createElement("p");
      linea.className = "habitacion-card-precio";
      linea.textContent = `$${precio} USD `;
      const detalle = document.createElement("small");
      detalle.textContent = `${etiquetaCapacidad(tarifa.capacidad)} · ${textoCatalogo("noche", "por noche")}`;
      linea.append(detalle);
      contenido.append(linea);
    }
  }

  const acciones = document.createElement("div");
  acciones.className = "habitacion-card-botones";
  const consulta = document.createElement("a");
  consulta.className = "btn btn-primary";
  consulta.href = "#reserva";
  consulta.dataset.reservarHotel = hotel.id;
  consulta.textContent = textoCatalogo("reservar", "Solicitar reserva");
  acciones.append(consulta);
  contenido.append(acciones);
  tarjeta.append(contenido);

  return tarjeta;
}

function renderizarHoteles() {
  if (!catalogo) return;
  if (!hotelesAliados.length) {
    mostrarEstadoCatalogo("vacio", "En este momento no hay opciones disponibles para mostrar.");
    return;
  }
  catalogo.replaceChildren(...hotelesAliados.map(crearTarjeta));
  llenarSelector(document.getElementById("reserva-hotel"), hotelesAliados, "Selecciona una opción de viaje", false);
  llenarSelector(document.getElementById("cotizacion-hotel"), hotelesAliados, "Sin opción por ahora", true);
}

async function cargarHotelesAliados() {
  try {
    const respuesta = await fetch("/api/habitaciones");
    if (!respuesta.ok) throw new Error("No se pudo cargar el catálogo");
    const resultado = await respuesta.json();
    if (!resultado.ok || !Array.isArray(resultado.data)) throw new Error("Respuesta de catálogo inválida");
    hotelesAliados = resultado.data;
    renderizarHoteles();
  } catch (error) {
    mostrarEstadoCatalogo("error", "No pudimos cargar las opciones de viaje. Inténtalo nuevamente más tarde.");
    console.error("Error al cargar opciones de viaje:", error);
  }
}

function llenarSelector(selector, opciones, etiquetaVacia, permiteVacio) {
  if (!selector) return;
  const seleccionado = selector.value;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = etiquetaVacia;
  if (!permiteVacio) placeholder.disabled = true;
  const elementos = opciones.map((opcion) => {
    const elemento = document.createElement("option");
    elemento.value = opcion.id;
    elemento.textContent = opcion.nombre;
    return elemento;
  });
  selector.replaceChildren(placeholder, ...elementos);
  if (opciones.some((opcion) => String(opcion.id) === seleccionado)) selector.value = seleccionado;
}

function crearTarjetaExperiencia(experiencia) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "experiencia-card";
  const imagen = document.createElement("img");
  imagen.src = experiencia.imagen_url || "";
  imagen.alt = experiencia.nombre;
  imagen.loading = "lazy";
  tarjeta.append(imagen);
  const contenido = document.createElement("div");
  contenido.className = "experiencia-card-content";
  contenido.append(crearTexto("span", "section-kicker", experiencia.categoria));
  contenido.append(crearTexto("h3", "", experiencia.nombre));
  contenido.append(crearTexto("p", "", experiencia.descripcion));
  if (experiencia.precio_usd !== null && experiencia.precio_usd !== undefined) {
    const unidad = experiencia.unidad_precio === "grupo" ? "por grupo" : "por persona";
    contenido.append(crearTexto("strong", "experiencia-precio", `$${Number(experiencia.precio_usd).toFixed(2)} USD ${unidad}`));
  } else {
    contenido.append(crearTexto("small", "experiencia-duracion", "Precio pendiente de publicar"));
  }
  contenido.append(crearTexto("small", "experiencia-duracion", `Duración estimada: ${experiencia.duracion || "por confirmar"}`));
  const enlace = document.createElement("a");
  enlace.className = "btn btn-outline";
  enlace.href = "#cotizacion";
  enlace.dataset.cotizarExperiencia = experiencia.id;
  enlace.textContent = "Cotizar experiencia";
  contenido.append(enlace);
  tarjeta.append(contenido);
  return tarjeta;
}

async function cargarExperiencias() {
  const lista = document.getElementById("experiencias-list");
  if (!lista) return;
  try {
    const respuesta = await fetch("/api/experiencias");
    const resultado = await respuesta.json();
    if (!respuesta.ok || !resultado.ok) throw new Error(resultado.error || "No se pudieron cargar las experiencias");
    llenarSelector(document.getElementById("cotizacion-experiencia"), resultado.data, "Sin tour por ahora", true);
    lista.replaceChildren(...resultado.data.map(crearTarjetaExperiencia));
  } catch (error) {
    lista.replaceChildren(crearTexto("p", "catalogo-estado", "No pudimos cargar las experiencias. Puedes pedir una cotización personalizada."));
    console.error("Error al cargar experiencias:", error);
  }
}

async function enviarFormulario(formulario, endpoint) {
  const boton = formulario.querySelector("button[type='submit']");
  const estado = formulario.querySelector(".form-status");
  estado.className = "form-status";
  estado.textContent = "Enviando...";
  boton.disabled = true;
  try {
    const respuesta = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(formulario).entries())),
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok || !resultado.ok) throw new Error(resultado.error || "No pudimos enviar la solicitud.");
    estado.classList.add("form-status-exito");
    estado.textContent = `${resultado.mensaje} Código: ${resultado.codigo}.`;
    if (endpoint !== "/api/cotizaciones" && resultado.resumen?.subtotalUsd !== undefined) {
      estado.textContent += ` Estimado de hospedaje: $${resultado.resumen.subtotalUsd} USD; anticipo estimado: $${resultado.resumen.anticipoEstimadoUsd} USD.`;
    } else if (endpoint !== "/api/cotizaciones" && resultado.resumen?.hospedajeEstimadoUsd !== undefined) {
      estado.textContent += ` Hospedaje estimado: $${resultado.resumen.hospedajeEstimadoUsd} USD; anticipo estimado: $${resultado.resumen.anticipoHospedajeEstimadoUsd} USD.`;
    }
    if (endpoint === "/api/cotizaciones") {
      const resumen = resultado.resumen || {};
      const formatoMonto = (valor) => valor === null || valor === undefined
        ? "Pendiente"
        : `$${Number(valor).toFixed(2)} USD`;
      const lineas = [
        `Hospedaje: ${formatoMonto(resumen.hospedajeEstimadoUsd)}.`,
      ];
      if (formulario.elements.experienciaId?.value) {
        lineas.push(`Tour: ${formatoMonto(resumen.experienciasEstimadasUsd)}.`);
      }
      lineas.push(resultado.cotizacionCompleta
        ? `Total automático: ${formatoMonto(resumen.totalEstimadoUsd)}.`
        : `Subtotal de conceptos tarifados: ${formatoMonto(resumen.totalEstimadoUsd)}. Los productos sin precio no están incluidos.`);
      lineas.push(`Anticipo estimado (25% del hospedaje): ${formatoMonto(resumen.anticipoHospedajeEstimadoUsd)}.`);
      estado.append(document.createElement("br"), document.createTextNode(lineas.join(" ")));
    }
    if (endpoint === "/api/cotizaciones") {
      const descarga = document.createElement("a");
      descarga.className = "btn btn-primary quote-pdf-download";
      descarga.href = `/api/cotizaciones/${encodeURIComponent(resultado.codigo)}/pdf`;
      descarga.textContent = "Descargar cotización en PDF";
      descarga.setAttribute("download", "");
      estado.append(document.createElement("br"), descarga);
    }
    formulario.reset();
  } catch (error) {
    estado.classList.add("form-status-error");
    estado.textContent = error.message;
  } finally {
    boton.disabled = false;
  }
}

function configurarFormularios() {
  const rutas = [
    ["form-reserva", "/api/reservas"],
    ["form-cotizacion", "/api/cotizaciones"],
    ["form-contacto", "/api/contacto"],
  ];
  for (const [id, endpoint] of rutas) {
    const formulario = document.getElementById(id);
    formulario?.addEventListener("submit", (evento) => {
      evento.preventDefault();
      enviarFormulario(formulario, endpoint);
    });
    formulario?.querySelectorAll("input[type='date']").forEach((campo) => {
      campo.min = new Date().toISOString().slice(0, 10);
    });
  }
}

document.addEventListener("click", (evento) => {
  const enlaceHotel = evento.target.closest("[data-reservar-hotel]");
  if (enlaceHotel) {
    const selector = document.getElementById("reserva-hotel");
    if (selector) selector.value = enlaceHotel.dataset.reservarHotel;
  }
  const enlaceExperiencia = evento.target.closest("[data-cotizar-experiencia]");
  if (enlaceExperiencia) {
    const selector = document.getElementById("cotizacion-experiencia");
    if (selector) selector.value = enlaceExperiencia.dataset.cotizarExperiencia;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  cargarHotelesAliados();
  cargarExperiencias();
  configurarFormularios();
});
window.addEventListener("traducciones:cargadas", renderizarHoteles);
