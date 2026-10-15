import type { Metadata } from "next";
import Link from "next/link";
import { exigirWopa } from "@/lib/sesion";
import { salir } from "../acceso/acciones";
import "@/estilos/globales.css";

export const metadata: Metadata = {
  title: "Panel · WOPA Travel",
  robots: { index: false, follow: false },
};

export default async function LayoutAdmin({ children }: LayoutProps<"/admin">) {
  const sesion = await exigirWopa();
  return (
    <html lang="es">
      <body>
        <div className="panel">
          <aside>
            <Link href="/admin" className="marca">WOPA <span>Panel</span></Link>
            <nav aria-label="Panel">
              <Link href="/admin">Hoteles</Link>
              <Link href="/admin/hoteles/nuevo">Nuevo hotel</Link>
              <Link href="/admin/reservas">Reservas</Link>
              <Link href="/admin/pagos">Pagos</Link>
              
              <Link href="/admin/soporte">Soporte</Link>
              <Link href="/admin/correos">Correos enviados</Link>
            </nav>
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
