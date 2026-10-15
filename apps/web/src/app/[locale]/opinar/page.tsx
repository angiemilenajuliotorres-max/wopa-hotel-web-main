import type { Metadata } from "next";
import { diccionario } from "@/i18n";
import { crearResenaAccion } from "../acciones";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const ERRORES: Record<string, { es: string; en: string }> = {
  RESERVA_NO_ENCONTRADA: { es: "No encontramos una reserva con ese código y correo.", en: "We couldn't find a booking with that code and email." },
  NO_RESENABLE: { es: "Solo puedes opinar después de tu estadía.", en: "You can review only after your stay." },
  RESENA_EXISTENTE: { es: "Ya dejaste tu opinión sobre esta estadía. ¡Gracias!", en: "You already reviewed this stay. Thank you!" },
  PUNTAJE_INVALIDO: { es: "Elige de 1 a 5 estrellas.", en: "Choose 1 to 5 stars." },
  COMENTARIO_CORTO: { es: "El comentario debe tener al menos 10 caracteres.", en: "Comments need at least 10 characters." },
};

export default async function PaginaOpinar({ params, searchParams }: PageProps<"/[locale]/opinar">) {
  const { idioma } = diccionario((await params).locale);
  const es = idioma === "es";
  const { codigo, error, enviada } = await searchParams;
  const mensaje = typeof error === "string" ? (ERRORES[error]?.[idioma] ?? (es ? "Ocurrió un error. Inténtalo de nuevo." : "Something went wrong. Please try again.")) : null;

  return (
    <div className="contenedor" style={{ marginTop: 32, maxWidth: 560 }}>
      <form action={crearResenaAccion} className="tarjeta pila">
        <h1>{es ? "¿Cómo estuvo tu estadía?" : "How was your stay?"}</h1>
        <p className="suave">{es ? "Solo publicamos opiniones de huéspedes que se alojaron, después de revisarlas." : "We only publish reviews from guests who stayed, after reviewing them."}</p>
        {enviada && <p className="aviso exito" role="status">{es ? "¡Gracias! Publicaremos tu opinión después de revisarla." : "Thank you! We'll publish your review after checking it."}</p>}
        {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
        <input type="hidden" name="idioma" value={idioma} />
        <div className="rejilla-2">
          <div className="campo"><label htmlFor="codigo">{es ? "Código de reserva" : "Booking code"}</label><input id="codigo" name="codigo" required defaultValue={typeof codigo === "string" ? codigo : ""} /></div>
          <div className="campo"><label htmlFor="correo">{es ? "Correo de la reserva" : "Booking email"}</label><input id="correo" name="correo" type="email" required /></div>
        </div>
        <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="etiqueta">{es ? "Puntaje" : "Rating"}</legend>
          <div className="fila">
            {[5, 4, 3, 2, 1].map((n) => (
              <label key={n} className="fila chico" style={{ gap: 4 }}><input type="radio" name="puntaje" value={n} required defaultChecked={n === 5} /> {"★".repeat(n)}</label>
            ))}
          </div>
        </fieldset>
        <div className="campo"><label htmlFor="comentario">{es ? "Comentario (opcional)" : "Comment (optional)"}</label><textarea id="comentario" name="comentario" maxLength={2000} /></div>
        <div className="campo"><label htmlFor="nombre">{es ? "Nombre que se mostrará" : "Display name"}</label><input id="nombre" name="nombre" required maxLength={60} placeholder={es ? "Ana P." : "Ann P."} /></div>
        <button className="boton dorado" type="submit">{es ? "Enviar opinión" : "Send review"}</button>
      </form>
    </div>
  );
}
