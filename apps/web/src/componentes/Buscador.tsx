"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

type Destino = { tipo: "ciudad" | "pais" | "hotel"; slug: string; nombre: string; detalle: string; hoteles?: number };

interface Textos {
  destino: string;
  destinoAyuda: string;
  entrada: string;
  salida: string;
  huespedes: string;
  buscar: string;
  ciudades: string;
  paises: string;
  hoteles: string;
  sinCoincidencias: string;
  elegirDestino: string;
}

export interface ValoresBuscador {
  destino?: { tipo: "ciudad" | "pais" | "hotel"; slug: string; nombre: string } | null;
  entrada: string;
  salida: string;
  huespedes: number;
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

export function Buscador({ idioma, textos, valores, hoy }: { idioma: "es" | "en"; textos: Textos; valores: ValoresBuscador; hoy: string }) {
  const router = useRouter();
  const idLista = useId();
  const [texto, setTexto] = useState(valores.destino?.nombre ?? "");
  const [elegido, setElegido] = useState(valores.destino ?? null);
  const [sugerencias, setSugerencias] = useState<Destino[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [entrada, setEntrada] = useState(valores.entrada);
  const [salida, setSalida] = useState(valores.salida);
  const [huespedes, setHuespedes] = useState(valores.huespedes);
  const [error, setError] = useState<string | null>(null);
  const contador = useRef(0);

  useEffect(() => {
    if (elegido && texto === elegido.nombre) return;
    if (texto.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    const numero = ++contador.current;
    const temporizador = setTimeout(async () => {
      try {
        const respuesta = await fetch(`/api/v1/destinos?q=${encodeURIComponent(texto)}&idioma=${idioma}`);
        const datos = (await respuesta.json()) as { destinos: Destino[] };
        if (numero === contador.current) {
          setSugerencias(datos.destinos);
          setAbierta(true);
          setActiva(-1);
        }
      } catch {
        setSugerencias([]);
      }
    }, 200);
    return () => clearTimeout(temporizador);
  }, [texto, idioma, elegido]);

  function elegir(destino: Destino) {
    setElegido(destino);
    setTexto(destino.nombre);
    setAbierta(false);
    setError(null);
  }

  function alTeclear(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierta || sugerencias.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setActiva((i) => (i + 1) % sugerencias.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
    } else if (evento.key === "Enter" && activa >= 0) {
      evento.preventDefault();
      elegir(sugerencias[activa]);
    } else if (evento.key === "Escape") {
      setAbierta(false);
    }
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const destino = elegido ?? (sugerencias.length === 1 ? sugerencias[0] : null);
    if (!destino) {
      setError(textos.elegirDestino);
      return;
    }
    const consulta = new URLSearchParams({ entrada, salida, huespedes: String(huespedes) });
    if (destino.tipo === "hotel") router.push(`/${idioma}/hotel/${destino.slug}?${consulta}`);
    else router.push(`/${idioma}/buscar?destino=${destino.tipo}:${destino.slug}&${consulta}`);
  }

  const grupos: { tipo: Destino["tipo"]; titulo: string }[] = [
    { tipo: "ciudad", titulo: textos.ciudades },
    { tipo: "pais", titulo: textos.paises },
    { tipo: "hotel", titulo: textos.hoteles },
  ];

  return (
    <form className="buscador" onSubmit={enviar} role="search">
      <div className="campo campo-destino autocompletar">
        <label htmlFor={`${idLista}-entrada`}>{textos.destino}</label>
        <input
          id={`${idLista}-entrada`}
          role="combobox"
          aria-expanded={abierta}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={activa >= 0 ? `${idLista}-${activa}` : undefined}
          placeholder={textos.destinoAyuda}
          autoComplete="off"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setElegido(null);
          }}
          onKeyDown={alTeclear}
          onFocus={() => sugerencias.length > 0 && setAbierta(true)}
          onBlur={() => setTimeout(() => setAbierta(false), 150)}
        />
        {abierta && (
          <ul className="sugerencias" id={idLista} role="listbox">
            {sugerencias.length === 0 && <li className="grupo">{textos.sinCoincidencias}</li>}
            {grupos.map(({ tipo, titulo }) => {
              const delGrupo = sugerencias.map((s, i) => ({ s, i })).filter(({ s }) => s.tipo === tipo);
              if (delGrupo.length === 0) return null;
              return (
                <li key={tipo} role="presentation">
                  <div className="grupo" aria-hidden="true">{titulo}</div>
                  <ul role="group" aria-label={titulo} style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {delGrupo.map(({ s, i }) => (
                      <li key={`${s.tipo}-${s.slug}`} role="option" id={`${idLista}-${i}`} aria-selected={i === activa}>
                        <button type="button" tabIndex={-1} aria-selected={i === activa} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(s)}>
                          <span>{s.nombre}</span>
                          <span className="suave chico">{s.tipo === "ciudad" ? `${s.detalle}${s.hoteles ? ` · ${s.hoteles}` : ""}` : s.detalle}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        {error && <span className="error-campo" role="alert">{error}</span>}
      </div>
      <div className="campo">
        <label htmlFor={`${idLista}-in`}>{textos.entrada}</label>
        <input
          id={`${idLista}-in`}
          type="date"
          min={hoy}
          value={entrada}
          required
          onChange={(e) => {
            setEntrada(e.target.value);
            if (salida <= e.target.value) setSalida(sumarDias(e.target.value, 1));
          }}
        />
      </div>
      <div className="campo">
        <label htmlFor={`${idLista}-out`}>{textos.salida}</label>
        <input id={`${idLista}-out`} type="date" min={sumarDias(entrada || hoy, 1)} value={salida} required onChange={(e) => setSalida(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor={`${idLista}-hues`}>{textos.huespedes}</label>
        <select id={`${idLista}-hues`} value={huespedes} onChange={(e) => setHuespedes(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <button className="boton dorado" type="submit">{textos.buscar}</button>
    </form>
  );
}
