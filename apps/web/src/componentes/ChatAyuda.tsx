"use client";

import { useEffect, useRef, useState } from "react";

type Mensaje = { autor: "cliente" | "asistente" | "sistema"; texto: string };

const TEXTOS = {
  es: {
    abrir: "Ayuda",
    titulo: "Asistente WOPA",
    subtitulo: "Disponible 24/7 · respondo con IA",
    bienvenida: "¡Hola! Puedo ayudarte a encontrar hotel, ver precios para tus fechas, consultar tu reserva o resolver dudas sobre el anticipo y las cancelaciones. ¿Qué necesitas?",
    escribe: "Escribe tu pregunta",
    enviar: "Enviar",
    pensando: "Escribiendo…",
    cerrar: "Cerrar",
    error: "No pude responder. Inténtalo de nuevo o escríbenos desde la página de ayuda.",
    ticket: (codigo: string) => `Abrimos el caso ${codigo}. El equipo te responderá por correo.`,
    valorar: "¿Te ayudó esta conversación?",
    gracias: "¡Gracias por tu opinión!",
  },
  en: {
    abrir: "Help",
    titulo: "WOPA assistant",
    subtitulo: "Available 24/7 · AI-powered",
    bienvenida: "Hi! I can help you find a hotel, check prices for your dates, look up your booking, or answer questions about deposits and cancellations. What do you need?",
    escribe: "Type your question",
    enviar: "Send",
    pensando: "Typing…",
    cerrar: "Close",
    error: "I couldn't reply. Try again or contact us from the help page.",
    ticket: (codigo: string) => `We opened case ${codigo}. Our team will reply by email.`,
    valorar: "Was this conversation helpful?",
    gracias: "Thanks for your feedback!",
  },
};

/** Convierte las URL del texto en enlaces, sin interpretar HTML. */
function ConEnlaces({ texto }: { texto: string }) {
  const partes = texto.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {partes.map((parte, i) =>
        /^https?:\/\//.test(parte) ? <a key={i} href={parte}>{parte.replace(/^https?:\/\/[^/]+/, "") || parte}</a> : <span key={i}>{parte}</span>,
      )}
    </>
  );
}

export function ChatAyuda({ idioma }: { idioma: "es" | "en" }) {
  const t = TEXTOS[idioma];
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ autor: "asistente", texto: t.bienvenida }]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [valorado, setValorado] = useState(false);
  const conversacion = useRef<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      conversacion.current = sessionStorage.getItem("wopa_chat");
    } catch {
      conversacion.current = null;
    }
  }, []);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight });
  }, [mensajes, enviando]);

  useEffect(() => {
    if (abierto) campo.current?.focus();
  }, [abierto]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const pregunta = texto.trim();
    if (!pregunta || enviando) return;
    setTexto("");
    setMensajes((m) => [...m, { autor: "cliente", texto: pregunta }]);
    setEnviando(true);
    try {
      const respuesta = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversacionId: conversacion.current, texto: pregunta, idioma }),
      });
      const datos = (await respuesta.json()) as { conversacionId?: string; respuesta?: string; ticket?: string | null; error?: { message?: string } };
      if (!respuesta.ok || !datos.respuesta) throw new Error(datos.error?.message ?? t.error);
      conversacion.current = datos.conversacionId ?? conversacion.current;
      try {
        if (conversacion.current) sessionStorage.setItem("wopa_chat", conversacion.current);
      } catch {
        /* sin almacenamiento: la conversación vive solo en esta pestaña */
      }
      setMensajes((m) => [...m, { autor: "asistente", texto: datos.respuesta! }, ...(datos.ticket ? [{ autor: "sistema" as const, texto: t.ticket(datos.ticket) }] : [])]);
    } catch (error) {
      setMensajes((m) => [...m, { autor: "sistema", texto: error instanceof Error ? error.message : t.error }]);
    } finally {
      setEnviando(false);
    }
  }

  async function valorar(valor: number) {
    setValorado(true);
    if (!conversacion.current) return;
    await fetch("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversacionId: conversacion.current, valoracion: valor, idioma }) }).catch(() => {});
  }

  const respondidas = mensajes.filter((m) => m.autor === "cliente").length;

  return (
    <div className="chat-ayuda">
      {abierto && (
        <section className="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chat-titulo" onKeyDown={(e) => e.key === "Escape" && setAbierto(false)}>
          <header className="chat-cabecera">
            <div>
              <strong id="chat-titulo">{t.titulo}</strong>
              <div className="chico">{t.subtitulo}</div>
            </div>
            <button type="button" className="chat-cerrar" onClick={() => setAbierto(false)} aria-label={t.cerrar}>×</button>
          </header>
          <div className="chat-mensajes" ref={lista} aria-live="polite">
            {mensajes.map((m, i) => (
              <p key={i} className={`chat-mensaje chat-${m.autor}`}><ConEnlaces texto={m.texto} /></p>
            ))}
            {enviando && <p className="chat-mensaje chat-asistente suave">{t.pensando}</p>}
            {respondidas >= 2 && !enviando && (
              <div className="chat-valorar chico">
                {valorado ? t.gracias : (
                  <>
                    <span>{t.valorar}</span>
                    {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => valorar(n)} aria-label={`${n}/5`}>{n}</button>)}
                  </>
                )}
              </div>
            )}
          </div>
          <form className="chat-formulario" onSubmit={enviar}>
            <label htmlFor="chat-texto" className="solo-lectores">{t.escribe}</label>
            <textarea
              id="chat-texto"
              ref={campo}
              rows={2}
              maxLength={2000}
              placeholder={t.escribe}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="boton" type="submit" disabled={enviando || !texto.trim()}>{t.enviar}</button>
          </form>
        </section>
      )}
      <button type="button" className="boton dorado chat-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {t.abrir}
      </button>
    </div>
  );
}
