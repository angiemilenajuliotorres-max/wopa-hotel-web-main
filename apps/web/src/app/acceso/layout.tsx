import type { Metadata } from "next";
import "@/estilos/globales.css";

export const metadata: Metadata = {
  title: "Acceso · WOPA Travel",
  robots: { index: false, follow: false },
};

export default function LayoutAcceso({ children }: LayoutProps<"/acceso">) {
  return (
    <html lang="es">
      <body>
        <main className="acceso">{children}</main>
      </body>
    </html>
  );
}
