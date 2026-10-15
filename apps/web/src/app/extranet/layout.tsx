import type { Metadata } from "next";
import Link from "next/link";
import { exigirSesion } from "@/lib/sesion";
import { salir } from "../acceso/acciones";
import "@/estilos/globales.css";

export const metadata: Metadata = {
  title: "Extranet · WOPA Travel",
  robots: { index: false, follow: false },
};

export default async function LayoutExtranet({ children }: LayoutProps<"/extranet">) {
  const sesion = await exigirSesion();
  return (
    <html lang="es">
      <body>
        <div className="panel">
          <aside>
            <Link href="/extranet" className="marca">WOPA <span>Hoteles</span></Link>
            <nav aria-label="Extranet"><Link href="/extranet">Mis hoteles</Link></nav>
            <div className="pila chico" style={{ marginTop: 32, color: "#cdd6ea" }}>
              <span>{sesion.usuario.nombre}</span>
              <form action={salir}><button className="boton secundario" type="submit">Cerrar sesión</button></form>
            </div>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
