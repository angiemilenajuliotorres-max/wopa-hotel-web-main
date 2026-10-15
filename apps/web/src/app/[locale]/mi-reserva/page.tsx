import type { Metadata } from "next";
import { diccionario, mensajeError } from "@/i18n";
import { consultarReservaAccion } from "../acciones";

export async function generateMetadata({ params }: PageProps<"/[locale]/mi-reserva">): Promise<Metadata> {
  const { t } = diccionario((await params).locale);
  return { title: t.miReserva.titulo, robots: { index: false, follow: true } };
}

export default async function PaginaMiReserva({ params, searchParams }: PageProps<"/[locale]/mi-reserva">) {
  const { t, idioma } = diccionario((await params).locale);
  const error = mensajeError(t, (await searchParams).error);
  return (
    <div className="contenedor" style={{ marginTop: 32, maxWidth: 520 }}>
      <form action={consultarReservaAccion} className="tarjeta pila">
        <h1>{t.miReserva.titulo}</h1>
        <p className="suave">{t.miReserva.texto}</p>
        {error && <p className="aviso error" role="alert">{error}</p>}
        <input type="hidden" name="idioma" value={idioma} />
        <div className="campo"><label htmlFor="codigo">{t.miReserva.codigo}</label><input id="codigo" name="codigo" required placeholder="WP-7KX2M9" autoCapitalize="characters" /></div>
        <div className="campo"><label htmlFor="correo">{t.miReserva.correo}</label><input id="correo" name="correo" type="email" autoComplete="email" required /></div>
        <button className="boton" type="submit">{t.miReserva.consultar}</button>
      </form>
    </div>
  );
}
