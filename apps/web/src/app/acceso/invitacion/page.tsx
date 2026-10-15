import { consultarInvitacion } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { activarInvitacion } from "../acciones";

const ROLES: Record<string, string> = {
  wopa_admin: "Administración WOPA",
  wopa_operaciones: "Operaciones WOPA",
  wopa_soporte: "Soporte WOPA",
  wopa_finanzas: "Finanzas WOPA",
  hotel_admin: "Administración del hotel",
  hotel_recepcion: "Recepción del hotel",
};

export default async function PaginaInvitacion({ searchParams }: PageProps<"/acceso/invitacion">) {
  const { token, error } = await searchParams;
  const invitacion = typeof token === "string" ? await consultarInvitacion(token) : null;
  const mensaje = mensajeDeError(error);

  if (!invitacion || typeof token !== "string") {
    return (
      <div className="tarjeta pila">
        <h1 style={{ fontSize: "1.4rem" }}>Invitación no válida</h1>
        <p>{mensajeDeError("INVITACION_INVALIDA")}</p>
      </div>
    );
  }

  return (
    <div className="tarjeta pila">
      <h1 style={{ fontSize: "1.4rem" }}>Activa tu cuenta</h1>
      <p className="suave">
        Te invitaron a <strong>{invitacion.organizacion}</strong> como {ROLES[invitacion.rol] ?? invitacion.rol}, con el correo {invitacion.correo}.
      </p>
      {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
      <form action={activarInvitacion} className="pila">
        <input type="hidden" name="token" value={token} />
        <div className="campo">
          <label htmlFor="nombre">Tu nombre</label>
          <input id="nombre" name="nombre" autoComplete="name" required minLength={2} />
        </div>
        <div className="campo">
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" name="clave" type="password" autoComplete="new-password" required minLength={12} aria-describedby="ayuda-clave" />
          <span id="ayuda-clave" className="ayuda">Mínimo 12 caracteres. Una frase larga es más segura y fácil de recordar.</span>
        </div>
        <div className="campo">
          <label htmlFor="clave2">Repite la contraseña</label>
          <input id="clave2" name="clave2" type="password" autoComplete="new-password" required minLength={12} />
        </div>
        <button className="boton" type="submit">Activar cuenta</button>
      </form>
    </div>
  );
}
