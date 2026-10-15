import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { iniciarConfiguracion2fa, obtenerSesion } from "@wopa/servicios";
import { mensajeDeError } from "@/lib/errores";
import { leerTokenSesion } from "@/lib/sesion";
import { confirmar2fa, salir, verificar2fa } from "../acciones";

export default async function PaginaSegundoFactor({ searchParams }: PageProps<"/acceso/2fa">) {
  const { error } = await searchParams;
  const token = await leerTokenSesion();
  const sesion = await obtenerSesion(token);
  if (!token || !sesion) redirect("/acceso");
  if (sesion.segundoFactorOk) redirect("/admin");
  const mensaje = mensajeDeError(error);

  const campoCodigo = (
    <div className="campo">
      <label htmlFor="codigo">Código de 6 dígitos</label>
      <input id="codigo" name="codigo" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
    </div>
  );

  if (sesion.tiene2fa) {
    return (
      <div className="tarjeta pila">
        <h1 style={{ fontSize: "1.4rem" }}>Verificación en dos pasos</h1>
        <p className="suave">Escribe el código que muestra tu aplicación autenticadora para {sesion.usuario.correo}.</p>
        {mensaje && <p className="aviso error" role="alert">{mensaje}</p>}
        <form action={verificar2fa} className="pila">
          {campoCodigo}
          <button className="boton" type="submit">Verificar</button>
        </form>
        <form action={salir}><button className="boton secundario" type="submit">Usar otra cuenta</button></form>
      </div>
    );
  }

  let configuracion: { secreto: string; qr: string } | null = null;
  let errorConfiguracion: string | null = null;
  try {
    const { secreto, uri } = await iniciarConfiguracion2fa(token);
    configuracion = { secreto, qr: await QRCode.toString(uri, { type: "svg", margin: 0 }) };
  } catch {
    errorConfiguracion = mensajeDeError("CONFIGURACION_INCOMPLETA");
  }

  return (
    <div className="tarjeta pila">
      <h1 style={{ fontSize: "1.4rem" }}>Activa la verificación en dos pasos</h1>
      <p className="suave">Es obligatoria para proteger reservas y pagos. Usa Google Authenticator, Microsoft Authenticator o 1Password.</p>
      {(mensaje || errorConfiguracion) && <p className="aviso error" role="alert">{mensaje ?? errorConfiguracion}</p>}
      {configuracion && (
        <>
          <ol className="pila" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Escanea este código con la aplicación.</li>
            <li>Escribe el código de 6 dígitos que aparece.</li>
          </ol>
          {/* SVG generado en el servidor a partir de nuestra propia URI otpauth. */}
          <div className="qr" aria-label="Código QR para la aplicación autenticadora" dangerouslySetInnerHTML={{ __html: configuracion.qr }} />
          <details>
            <summary className="chico">¿No puedes escanear? Escribe la clave a mano</summary>
            <code className="secreto">{configuracion.secreto}</code>
          </details>
          <form action={confirmar2fa} className="pila">
            {campoCodigo}
            <button className="boton" type="submit">Activar y entrar</button>
          </form>
        </>
      )}
    </div>
  );
}
