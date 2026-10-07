const loginView = document.getElementById("login-view");
const adminApp = document.getElementById("admin-app");
const globalStatus = document.getElementById("global-status");
const paymentDialog = document.getElementById("payment-dialog");
const money = new Intl.NumberFormat("es-PA", { style: "currency", currency: "USD" });
const estadoReserva = [
  ["pendiente_confirmacion", "Pendiente"],
  ["confirmada", "Confirmada"],
  ["rechazada", "Rechazada"],
  ["cancelada", "Cancelada"],
  ["completada", "Completada"],
];
const estadoCotizacion = [
  ["generada_automatica", "Automática completa"],
  ["estimado_parcial", "Automática parcial"],
  ["pendiente", "Pendiente"],
  ["en_revision", "En revisión"],
  ["cotizada", "Cotizada"],
  ["aceptada", "Aceptada"],
  ["rechazada", "Rechazada"],
];
const estadoContacto = [["nuevo", "Nuevo"], ["en_revision", "En revisión"], ["resuelto", "Resuelto"]];

function elemento(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function celda(row, text, className) {
  const td = elemento("td", className, text || "—");
  row.append(td);
  return td;
}

function tabla(contenedor, headers, rows) {
  const table = elemento("table");
  const thead = elemento("thead");
  const headerRow = elemento("tr");
  for (const header of headers) headerRow.append(elemento("th", "", header));
  thead.append(headerRow);
  const tbody = elemento("tbody");
  for (const row of rows) tbody.append(row);
  if (!rows.length) {
    const empty = elemento("tr");
    const cell = elemento("td", "", "No hay registros todavía.");
    cell.colSpan = headers.length;
    empty.append(cell);
    tbody.append(empty);
  }
  table.append(thead, tbody);
  contenedor.replaceChildren(table);
}

function opcionesSelect(options, valor) {
  const select = elemento("select");
  for (const [value, label] of options) {
    const option = elemento("option", "", label);
    option.value = value;
    option.selected = value === valor;
    select.append(option);
  }
  return select;
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (response.status === 401) {
    mostrarLogin();
    throw new Error("Tu sesión terminó. Inicia sesión otra vez.");
  }
  if (!response.ok) throw new Error(body?.error || `Error del servidor (${response.status}).`);
  return body;
}

function mostrarLogin() {
  adminApp.hidden = true;
  loginView.hidden = false;
}

function mostrarPanel(usuario) {
  loginView.hidden = true;
  adminApp.hidden = false;
  document.getElementById("admin-user").textContent = usuario;
  cargarVista("resumen");
}

function mensajeGlobal(mensaje, error = false) {
  globalStatus.textContent = mensaje;
  globalStatus.classList.toggle("error", error);
}

function campoMetric(label, value) {
  const card = elemento("article", "metric");
  card.append(elemento("span", "", label), elemento("strong", "", value));
  return card;
}

async function cargarResumen() {
  const [{ data }, { data: reservas }] = await Promise.all([
    api("/api/admin/resumen"),
    api("/api/admin/reservas"),
  ]);
  document.getElementById("summary-grid").replaceChildren(
    campoMetric("Reservas pendientes", data.reservas_pendientes),
    campoMetric("Cotizaciones pendientes", data.cotizaciones_pendientes),
    campoMetric("Mensajes por atender", data.mensajes_pendientes),
    campoMetric("Utilidad neta registrada", money.format(data.utilidad_neta_usd)),
    campoMetric("Ingresos registrados", money.format(data.ingresos_usd)),
    campoMetric("Gastos registrados", money.format(data.gastos_usd)),
    campoMetric("Penalizaciones aplicadas", money.format(data.penalizaciones_usd)),
    campoMetric("Solicitudes de reserva", data.reservas),
  );
  const rows = reservas.slice(0, 6).map((item) => {
    const row = elemento("tr");
    celda(row, item.codigo, "code");
    celda(row, item.nombre);
    celda(row, item.hotel);
    celda(row, item.fecha_entrada);
    celda(row, item.estado);
    celda(row, money.format(item.subtotal_usd));
    return row;
  });
  tabla(document.getElementById("recent-reservations"), ["Código", "Cliente", "Opción de viaje", "Entrada", "Estado", "Total"], rows);
}

async function cargarReservas() {
  const { data } = await api("/api/admin/reservas");
  const rows = data.map((item) => {
    const row = elemento("tr");
    celda(row, item.codigo, "code");
    const customer = celda(row, "");
    customer.append(elemento("strong", "", item.nombre), elemento("br"), elemento("span", "", item.correo), elemento("br"), elemento("span", "", item.telefono));
    celda(row, item.hotel);
    celda(row, `${item.fecha_entrada} → ${item.fecha_salida} · ${item.numero_personas} pers.`);
    const amounts = celda(row, "");
    amounts.append(elemento("div", "", `Total: ${money.format(item.subtotal_usd)}`), elemento("div", "", `Abonado: ${money.format(item.abonado_usd)}`));
    if (Number(item.monto_penalizacion_usd)) amounts.append(elemento("div", "", `Penalización: ${money.format(item.monto_penalizacion_usd)}`));
    celda(row, item.estado);
    const actions = celda(row, "", "actions");
    const select = opcionesSelect(estadoReserva, item.estado);
    const save = elemento("button", "button button-quiet", "Guardar estado");
    save.type = "button";
    save.addEventListener("click", async () => {
      let motivoCancelacion = "";
      if (select.value === "cancelada") {
        motivoCancelacion = window.prompt("Motivo de cancelación:") || "";
        if (motivoCancelacion.trim().length < 3) return mensajeGlobal("Escribe un motivo de cancelación de al menos 3 caracteres.", true);
      }
      const notaAdmin = window.prompt("Nota administrativa (opcional):") || "";
      try {
        const result = await api(`/api/admin/reservas/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: select.value, motivoCancelacion, notaAdmin }),
        });
        mensajeGlobal(select.value === "cancelada" ? `Cancelación registrada. Penalización aplicada: ${money.format(result.penalizacionUsd)}.` : "Estado de reserva actualizado.");
        await cargarReservas();
      } catch (error) { mensajeGlobal(error.message, true); }
    });
    const payment = elemento("button", "button button-primary", "Registrar pago");
    payment.type = "button";
    payment.disabled = ["cancelada", "rechazada"].includes(item.estado);
    payment.addEventListener("click", () => abrirPago(item));
    const controls = elemento("div", "row-actions");
    controls.append(select, save, payment);
    actions.append(controls);
    return row;
  });
  tabla(document.getElementById("reservations-table"), ["Código", "Cliente", "Opción", "Fechas / grupo", "Importes", "Estado", "Acciones"], rows);
}

function abrirPago(reserva) {
  const form = document.getElementById("payment-form");
  form.elements.reservaId.value = reserva.id;
  form.elements.montoUsd.max = Math.max(0, Number(reserva.subtotal_usd) - Number(reserva.abonado_usd)).toFixed(2);
  document.getElementById("payment-reservation-label").textContent = `${reserva.codigo} · pendiente ${money.format(Number(reserva.subtotal_usd) - Number(reserva.abonado_usd))}`;
  form.querySelector(".status").textContent = "";
  paymentDialog.showModal();
}

async function cargarCotizaciones() {
  const { data } = await api("/api/admin/cotizaciones");
  const rows = data.map((item) => {
    const row = elemento("tr");
    celda(row, item.codigo, "code");
    const customer = celda(row, "");
    customer.append(elemento("strong", "", item.nombre), elemento("br"), elemento("span", "", item.correo), elemento("br"), elemento("span", "", item.telefono));
    celda(row, [item.hotel, item.experiencia].filter(Boolean).join(" + "));
    celda(row, `${item.fecha_entrada || "Fechas flexibles"} → ${item.fecha_salida || "por definir"} · ${item.numero_personas} pers.`);
    const estimate = celda(row, "");
    estimate.append(elemento("div", "", `Hospedaje: ${item.subtotal_hospedaje_usd === null ? "Pendiente" : money.format(item.subtotal_hospedaje_usd)}`));
    estimate.append(elemento("div", "", `Tour: ${item.subtotal_experiencias_usd === null ? (item.experiencia ? "Pendiente de tarifa" : "No incluido") : money.format(item.subtotal_experiencias_usd)}`));
    estimate.append(elemento("strong", "", `Total: ${item.total_estimado_usd === null ? "Pendiente" : money.format(item.total_estimado_usd)}`));
    celda(row, item.notas);
    const actions = celda(row, "", "actions");
    const select = opcionesSelect(estadoCotizacion, item.estado);
    const save = elemento("button", "button button-quiet", "Guardar");
    save.type = "button";
    save.addEventListener("click", async () => {
      const notaAdmin = window.prompt("Seguimiento administrativo:") || "";
      try {
        await api(`/api/admin/cotizaciones/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: select.value, notaAdmin }) });
        mensajeGlobal("Cotización actualizada.");
        await cargarCotizaciones();
      } catch (error) { mensajeGlobal(error.message, true); }
    });
    const controls = elemento("div", "row-actions");
    controls.append(select, save);
    actions.append(controls);
    celda(row, item.estado);
    return row;
  });
  tabla(document.getElementById("quotes-table"), ["Código", "Cliente", "Opciones", "Fechas / grupo", "Desglose automático", "Notas del cliente", "Acciones", "Estado"], rows);
}

async function cargarContactos() {
  const { data } = await api("/api/admin/contactos");
  const rows = data.map((item) => {
    const row = elemento("tr");
    celda(row, item.codigo, "code");
    const person = celda(row, "");
    person.append(elemento("strong", "", item.nombre), elemento("br"), elemento("span", "", item.correo), elemento("br"), elemento("span", "", item.telefono));
    celda(row, item.asunto);
    celda(row, item.mensaje);
    const actions = celda(row, "", "actions");
    const select = opcionesSelect(estadoContacto, item.estado);
    const save = elemento("button", "button button-quiet", "Guardar");
    save.type = "button";
    save.addEventListener("click", async () => {
      const notaAdmin = window.prompt("Nota interna de seguimiento:") || "";
      try {
        await api(`/api/admin/contactos/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: select.value, notaAdmin }) });
        mensajeGlobal("Mensaje actualizado.");
        await cargarContactos();
      } catch (error) { mensajeGlobal(error.message, true); }
    });
    const controls = elemento("div", "row-actions");
    controls.append(select, save);
    actions.append(controls);
    return row;
  });
  tabla(document.getElementById("contacts-table"), ["Código", "Remitente", "Asunto", "Mensaje", "Seguimiento"], rows);
}

async function cargarFinanzas() {
  const [{ data }, { data: movimientos }] = await Promise.all([api("/api/admin/resumen"), api("/api/admin/movimientos")]);
  document.getElementById("finance-summary").replaceChildren(
    campoMetric("Ingresos", money.format(data.ingresos_usd)),
    campoMetric("Gastos", money.format(data.gastos_usd)),
    campoMetric("Utilidad neta", money.format(data.utilidad_neta_usd)),
    campoMetric("Penalizaciones registradas", money.format(data.penalizaciones_usd)),
  );
  const rows = movimientos.map((item) => {
    const row = elemento("tr");
    celda(row, item.fecha);
    celda(row, "", `pill ${item.tipo === "ingreso" ? "income" : "expense"}`).textContent = item.tipo === "ingreso" ? "Ingreso" : "Gasto";
    celda(row, item.categoria);
    celda(row, item.descripcion);
    celda(row, item.reserva_codigo || "—");
    celda(row, money.format(item.monto_usd));
    return row;
  });
  tabla(document.getElementById("movements-table"), ["Fecha", "Tipo", "Categoría", "Descripción", "Reserva", "Monto USD"], rows);
}

async function cargarCatalogo() {
  const { data } = await api("/api/admin/catalogo");
  const hotelsList = document.getElementById("hotels-admin-list");
  const hotelForms = data.hoteles.map((hotel) => {
    const form = elemento("form", "experience-admin panel");
    const addField = (labelText, name, value, type = "text") => {
      const label = elemento("label", "", labelText);
      const input = elemento("input");
      input.name = name;
      input.type = type;
      input.value = value ?? "";
      if (type === "number") { input.min = "2"; input.max = "4"; input.step = "1"; }
      label.append(input);
      form.append(label);
    };
    addField("Nombre del aliado", "nombre", hotel.nombre);
    addField("Capacidad máxima", "capacidadMaxima", hotel.capacidad_maxima, "number");
    const description = elemento("label", "description", "Descripción");
    const descriptionInput = elemento("textarea");
    descriptionInput.name = "descripcion";
    descriptionInput.required = true;
    descriptionInput.value = hotel.descripcion || "";
    description.append(descriptionInput);
    form.append(description);
    const services = elemento("label", "description", "Servicios separados por comas");
    const servicesInput = elemento("input");
    servicesInput.name = "servicios";
    servicesInput.value = hotel.servicios || "";
    services.append(servicesInput);
    form.append(services);
    const save = elemento("button", "button button-primary", "Guardar aliado");
    save.type = "submit";
    form.append(save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/admin/hoteles/${hotel.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
        });
        mensajeGlobal("Ficha de la opción de viaje actualizada.");
      } catch (error) { mensajeGlobal(error.message, true); }
    });
    return form;
  });
  hotelsList.replaceChildren(...hotelForms);

  const rateRows = [];
  for (const hotel of data.hoteles) {
    for (const tarifa of hotel.tarifas) {
      const row = elemento("tr");
      celda(row, hotel.nombre);
      celda(row, tarifa.temporada);
      celda(row, tarifa.capacidad <= 2 ? "1–2 personas" : "3–4 personas");
      const priceCell = celda(row, "");
      const input = elemento("input");
      input.type = "number";
      input.min = "0.01";
      input.step = "0.01";
      input.value = tarifa.precio_usd;
      input.setAttribute("aria-label", `Precio para ${hotel.nombre}`);
      priceCell.append(input);
      const actionCell = celda(row, "");
      const save = elemento("button", "button button-quiet", "Guardar tarifa");
      save.type = "button";
      save.addEventListener("click", async () => {
        try {
          await api(`/api/admin/tarifas/${tarifa.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ precioUsd: input.value }) });
          mensajeGlobal(`Tarifa de ${hotel.nombre} actualizada.`);
        } catch (error) { mensajeGlobal(error.message, true); }
      });
      actionCell.append(save);
      rateRows.push(row);
    }
  }
  tabla(document.getElementById("rates-table"), ["Opción de viaje", "Temporada", "Capacidad", "Precio USD / noche", "Acción"], rateRows);

  const list = document.getElementById("experiences-list");
  const forms = data.experiencias.map((experience) => {
    const form = elemento("form", "experience-admin panel");
    form.dataset.experienceId = experience.id;
    const addField = (labelText, name, value, type = "text") => {
      const label = elemento("label", "", labelText);
      const input = elemento("input");
      input.name = name;
      input.type = type;
      input.value = value ?? "";
      if (type === "number") { input.min = "0.01"; input.step = "0.01"; }
      label.append(input);
      form.append(label);
    };
    addField("Nombre", "nombre", experience.nombre);
    addField("Categoría", "categoria", experience.categoria);
    addField("Duración", "duracion", experience.duracion);
    addField("Precio opcional USD", "precioUsd", experience.precio_usd, "number");
    const unitLabel = elemento("label", "", "La tarifa del tour es");
    const unitSelect = opcionesSelect([["persona", "Por persona"], ["grupo", "Por grupo completo"]], experience.unidad_precio || "persona");
    unitSelect.name = "unidadPrecio";
    unitLabel.append(unitSelect);
    form.append(unitLabel);
    addField("Imagen URL", "imagenUrl", experience.imagen_url);
    const description = elemento("label", "description", "Descripción");
    const textarea = elemento("textarea");
    textarea.name = "descripcion";
    textarea.value = experience.descripcion;
    description.append(textarea);
    form.append(description);
    const activeLabel = elemento("label", "experience-active", "Activa");
    const active = elemento("input");
    active.name = "activa";
    active.type = "checkbox";
    active.checked = Boolean(experience.activa);
    activeLabel.append(active);
    form.append(activeLabel);
    const save = elemento("button", "button button-primary", "Guardar experiencia");
    save.type = "submit";
    form.append(save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      try {
        await api(`/api/admin/experiencias/${experience.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...Object.fromEntries(formData.entries()), activa: active.checked, precioUsd: formData.get("precioUsd") || null }),
        });
        mensajeGlobal("Experiencia actualizada.");
      } catch (error) { mensajeGlobal(error.message, true); }
    });
    return form;
  });
  list.replaceChildren(...forms);
}

async function cargarVista(view) {
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".admin-view").forEach((panel) => { panel.hidden = panel.id !== `view-${view}`; });
  mensajeGlobal("");
  const cargar = {
    resumen: cargarResumen,
    reservas: cargarReservas,
    cotizaciones: cargarCotizaciones,
    contactos: cargarContactos,
    finanzas: cargarFinanzas,
    catalogo: cargarCatalogo,
  }[view];
  try { await cargar(); } catch (error) { mensajeGlobal(error.message, true); }
}

async function descargarInforme() {
  try {
    const semana = document.getElementById("report-week").value;
    if (!semana) throw new Error("Selecciona la semana que quieres incluir en el informe.");
    const response = await fetch(`/api/admin/informe.xlsx?semana=${encodeURIComponent(semana)}`, { credentials: "same-origin" });
    if (response.status === 401) { mostrarLogin(); throw new Error("Inicia sesión para descargar el informe."); }
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "No se pudo descargar el informe.");
    }
    const blob = await response.blob();
    const link = elemento("a");
    link.href = URL.createObjectURL(blob);
    link.download = `wopa-informe-${semana}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    mensajeGlobal(`Informe semanal ${semana} descargado.`);
  } catch (error) { mensajeGlobal(error.message, true); }
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById("login-status");
  status.className = "status";
  status.textContent = "Validando acceso...";
  try {
    const result = await api("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    mostrarPanel(result.usuario);
  } catch (error) { status.classList.add("error"); status.textContent = error.message; }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } finally { mostrarLogin(); }
});

document.querySelectorAll(".nav-tab").forEach((tab) => tab.addEventListener("click", () => cargarVista(tab.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => cargarVista(button.dataset.viewLink)));
document.querySelectorAll("[data-download-report]").forEach((button) => button.addEventListener("click", descargarInforme));

document.getElementById("movement-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".status");
  status.className = "status";
  try {
    await api("/api/admin/movimientos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    form.reset();
    form.elements.fecha.value = new Date().toISOString().slice(0, 10);
    status.classList.add("success");
    status.textContent = "Movimiento guardado.";
    await cargarFinanzas();
  } catch (error) { status.classList.add("error"); status.textContent = error.message; }
});

for (const [formId, endpoint, successMessage] of [
  ["new-hotel-form", "/api/admin/hoteles", "Opción de viaje creada con sus dos tarifas."],
  ["new-experience-form", "/api/admin/experiencias", "Experiencia creada."],
]) {
  document.getElementById(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector(".status");
    status.className = "status";
    try {
      await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset();
      status.classList.add("success");
      status.textContent = successMessage;
      await cargarCatalogo();
    } catch (error) { status.classList.add("error"); status.textContent = error.message; }
  });
}

document.getElementById("payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".status");
  status.className = "status";
  try {
    const id = form.elements.reservaId.value;
    const result = await api(`/api/admin/reservas/${id}/pagos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ montoUsd: form.elements.montoUsd.value, referencia: form.elements.referencia.value }) });
    paymentDialog.close();
    mensajeGlobal(`Pago registrado. Acumulado: ${money.format(result.abonadoUsd)}; saldo: ${money.format(result.saldoUsd)}.`);
    await cargarReservas();
  } catch (error) { status.classList.add("error"); status.textContent = error.message; }
});

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll("input[type='date']").forEach((input) => { if (!input.value) input.value = new Date().toISOString().slice(0, 10); });
  const reportWeek = document.getElementById("report-week");
  if (reportWeek && !reportWeek.value) {
    const thursday = new Date();
    thursday.setHours(0, 0, 0, 0);
    thursday.setDate(thursday.getDate() + 4 - (thursday.getDay() || 7));
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    reportWeek.value = `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  try {
    const result = await api("/api/admin/me");
    mostrarPanel(result.usuario);
  } catch {
    mostrarLogin();
  }
});
