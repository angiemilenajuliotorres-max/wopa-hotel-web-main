import type { Metadata } from "next";
import Link from "next/link";
import { ChatAyuda } from "@/componentes/ChatAyuda";
import { diccionario } from "@/i18n";
import "@/estilos/globales.css";

// Precios, cupos y reservas cambian a cada momento: todo se renderiza al pedirlo.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { t, idioma } = diccionario((await params).locale);
  return {
    title: { default: t.meta.titulo, template: `%s · WOPA Travel` },
    description: t.meta.descripcion,
    metadataBase: new URL(process.env.URL_PUBLICA ?? "http://localhost:3100"),
    alternates: { languages: { es: "/es", en: "/en" } },
    openGraph: { siteName: "WOPA Travel", locale: idioma === "es" ? "es_PA" : "en_US", type: "website" },
  };
}

export default async function LayoutPublico({ children, params }: LayoutProps<"/[locale]">) {
  const { t, idioma } = diccionario((await params).locale);
  return (
    <html lang={idioma}>
      <body>
        <a className="solo-lectores" href="#contenido">{idioma === "es" ? "Ir al contenido" : "Skip to content"}</a>
        <header className="cabecera">
          <div className="contenedor">
            <Link href={`/${idioma}`} className="marca">WOPA <span>Travel</span></Link>
            <nav className="nav" aria-label={idioma === "es" ? "Principal" : "Main"}>
              <Link href={`/${idioma}/tours`}>Tours</Link>
              <Link href={`/${idioma}/mi-reserva`}>{t.nav.miReserva}</Link>
              <Link href={`/${idioma}/ayuda`}>{t.nav.ayuda}</Link>
              <Link className="idioma" href={`/${t.nav.codigoOtroIdioma}`} hrefLang={t.nav.codigoOtroIdioma} lang={t.nav.codigoOtroIdioma}>
                {t.nav.otroIdioma}
              </Link>
            </nav>
          </div>
        </header>
        <main id="contenido">{children}</main>
        <ChatAyuda idioma={idioma} />
        <footer className="pie">
          <div className="contenedor fila entre">
            <span>{t.pie.texto}</span>
            <nav className="fila" aria-label={idioma === "es" ? "Legal" : "Legal"}>
              <a href="/legal/terminos.html">{t.pie.terminos}</a>
              <a href="/legal/privacidad.html">{t.pie.privacidad}</a>
              <a href="/legal/cancelacion.html">{t.pie.cancelacion}</a>
              <Link href="/acceso">{t.nav.equipo}</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
