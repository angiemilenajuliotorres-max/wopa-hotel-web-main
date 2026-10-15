import { mensajeDeError } from "@/lib/errores";
import { entrar } from "./acciones";

export default async function PaginaAcceso({ searchParams }: PageProps<"/acceso">) {
  const { error, activada } = await searchParams;
  const mensaje = mensajeDeError(error);
  return (
    <div className="tarjeta pila">
      <div>
        <p className="marca" style={{ color: "var(--azul-profundo)" }}>WOPA <span style={{ color: "var(--azul)" }}>Travel</span></p>
        <h1 style={{ fontSize: "1.4rem" }}>Acceso para equipo y hoteles</h1>
        <p className="suave chico">Las cuentas las crea WOPA. Si eres un hotel aliado y no tienes acceso, pídeselo a tu contacto en WOPA.</p>
      </div>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      {activada && <p className="aviso exito" role="status">Tu cuenta está activa. Inicia sesión para configurar la verificación en dos pasos.</p>}
      <form action={entrar} className="pila">
        <div className="campo">
          <label htmlFor="correo">Correo</label>
          <input id="correo" name="correo" type="email" autoComplete="username" required />
        </div>
        <div className="campo">
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" name="clave" type="password" autoComplete="current-password" required minLength={12} />
        </div>
        <button className="boton" type="submit">Continuar</button>
      </form>
    </div>
  );
}
