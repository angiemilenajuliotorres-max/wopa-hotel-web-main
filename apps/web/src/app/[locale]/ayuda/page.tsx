import type { Metadata } from "next";
import { listarArticulos, listarCategorias } from "@wopa/servicios";
import { diccionario, mensajeError } from "@/i18n";
import { crearTicketAccion } from "../acciones";

export async function generateMetadata({ params }: PageProps<"/[locale]/ayuda">): Promise<Metadata> {
  const { t, idioma } = diccionario((await params).locale);
  return { title: t.ayuda.titulo, alternates: { canonical: `/${idioma}/ayuda`, languages: { es: "/es/ayuda", en: "/en/ayuda" } } };
}

export default async function PaginaAyuda({ params, searchParams }: PageProps<"/[locale]/ayuda">) {
  const { t, idioma } = diccionario((await params).locale);
  const parametros = await searchParams;
  const [articulos, categorias] = await Promise.all([listarArticulos(idioma), listarCategorias(idioma)]);
  const error = mensajeError(t, parametros.error);
  const reserva = typeof parametros.reserva === "string" ? parametros.reserva : "";

  return (
    <div className="contenedor pila" style={{ marginTop: 24 }}>
      <h1>{t.ayuda.titulo}</h1>
      {typeof parametros.enviado === "string" && <p className="aviso exito" role="status">{t.ayuda.enviado(parametros.enviado)}</p>}
      <div className="rejilla-2" style={{ alignItems: "start" }}>
        <section className="pila" aria-labelledby="titulo-preguntas">
          <h2 id="titulo-preguntas">{t.ayuda.preguntas}</h2>
          {articulos.map((articulo) => (
            <details key={articulo.slug} id={articulo.slug} className="tarjeta">
              <summary><strong>{articulo.titulo}</strong></summary>
              <div style={{ marginTop: 10 }}>{articulo.contenido.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
            </details>
          ))}
        </section>
        <section id="contacto" className="tarjeta pila" aria-labelledby="titulo-contacto">
          <h2 id="titulo-contacto">{t.ayuda.contacto}</h2>
          <p className="suave chico">{t.ayuda.contactoTexto}</p>
          {error && <p className="aviso error" role="alert">{error}</p>}
          <form action={crearTicketAccion} className="pila">
            <input type="hidden" name="idioma" value={idioma} />
            <div className="campo">
              <label htmlFor="categoria">{t.ayuda.tema}</label>
              <select id="categoria" name="categoria" defaultValue={reserva ? "reserva" : "otro"}>
                {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="rejilla-2">
              <div className="campo"><label htmlFor="nombre-ayuda">{t.reserva.nombre}</label><input id="nombre-ayuda" name="nombre" autoComplete="name" required /></div>
              <div className="campo"><label htmlFor="correo-ayuda">{t.reserva.correo}</label><input id="correo-ayuda" name="correo" type="email" autoComplete="email" required /></div>
            </div>
            <div className="campo"><label htmlFor="reserva-ayuda">{t.ayuda.reserva}</label><input id="reserva-ayuda" name="reserva" defaultValue={reserva} /></div>
            <div className="campo"><label htmlFor="asunto">{t.ayuda.asunto}</label><input id="asunto" name="asunto" required minLength={3} maxLength={200} defaultValue={typeof parametros.asunto === "string" ? parametros.asunto : ""} /></div>
            <div className="campo"><label htmlFor="mensaje">{t.ayuda.mensaje}</label><textarea id="mensaje" name="mensaje" required minLength={5} maxLength={8000} /></div>
            <button className="boton" type="submit">{t.ayuda.enviar}</button>
          </form>
        </section>
      </div>
    </div>
  );
}
