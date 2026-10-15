import type { Metadata } from "next";
import "@/estilos/globales.css";

export const metadata: Metadata = { title: "Pasarela simulada", robots: { index: false, follow: false } };

export default function LayoutPagos({ children }: LayoutProps<"/pagos">) {
  return (
    <html lang="es">
      <body>
        <main className="acceso">{children}</main>
      </body>
    </html>
  );
}
