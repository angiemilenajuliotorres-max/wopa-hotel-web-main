// Script de manejo de idiomas

// Cargar traducciones iniciales
document.addEventListener("DOMContentLoaded", () => {
  const idioma = localStorage.getItem("idioma") || "es";
  cargarTraducciones(idioma);
  document.querySelectorAll(".idioma-btn[data-idioma]").forEach((boton) => {
    boton.addEventListener("click", () => cargarTraducciones(boton.dataset.idioma));
  });
});

// Función para cargar traducciones desde archivo JSON
async function cargarTraducciones(idioma) {
  if (!["es", "en"].includes(idioma)) return;
  try {
    const response = await fetch(`/idiomas/${idioma}.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const traducciones = await response.json();
    window.traducciones = traducciones;
    localStorage.setItem("idioma", idioma);
    document.documentElement.lang = idioma;
    aplicarTraducciones();
    document.querySelectorAll(".idioma-btn[data-idioma]").forEach((boton) => {
      const activo = boton.dataset.idioma === idioma;
      boton.classList.toggle("activo", activo);
      boton.setAttribute("aria-pressed", String(activo));
    });
    window.dispatchEvent(new Event("traducciones:cargadas"));
  } catch (error) {
    console.error(`Error al cargar traducciones para ${idioma}:`, error);
  }
}

// Aplicar traducciones a la página
function aplicarTraducciones() {
  document.querySelectorAll("[data-i18n]").forEach((elemento) => {
    const clave = elemento.dataset.i18n;
    const texto = obtenerTexto(clave);

    if (texto) {
      if (elemento.tagName === "INPUT") {
        elemento.placeholder = texto;
      } else if (elemento.tagName === "LABEL") {
        elemento.textContent = texto;
      } else {
        elemento.textContent = texto;
      }
    }
  });
}

// Obtener texto traducido usando clave anidada (ej: "hero.titulo")
function obtenerTexto(clave) {
  if (!window.traducciones) return null;

  const partes = clave.split(".");
  let valor = window.traducciones;

  for (const parte of partes) {
    if (valor && Object.prototype.hasOwnProperty.call(valor, parte)) {
      valor = valor[parte];
    } else {
      return null;
    }
  }

  return valor;
}

// Exportar funciones globales
window.cargarTraducciones = cargarTraducciones;
window.aplicarTraducciones = aplicarTraducciones;
window.obtenerTexto = obtenerTexto;
