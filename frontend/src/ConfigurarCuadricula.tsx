import { useId } from "react";
import Cuadricula from "./Cuadricula";
import { generarZonas, MAXIMO_DIMENSION, type GeometriaCuadricula } from "./cuadricula";

/** Configura dimensiones y acomodo para archivos antiguos sin geometría. */
export default function ConfigurarCuadricula({ valor, onChange, bloqueado = false }: {
  valor: GeometriaCuadricula;
  onChange: (valor: GeometriaCuadricula) => void;
  bloqueado?: boolean;
}) {
  const id = useId();
  function dimension(campo: "filas" | "columnas", texto: string) {
    const numero = Number(texto);
    if (!Number.isInteger(numero) || numero < 1 || numero > MAXIMO_DIMENSION) return;
    const siguiente = { ...valor, [campo]: numero };
    onChange({ ...siguiente, zonas: generarZonas(siguiente.filas, siguiente.columnas) });
  }
  return <fieldset className="dimensiones configuracion-geometria" disabled={bloqueado}>
    <legend>Cuadrícula de las mediciones</legend>
    <div className="campos-dimensiones">
      <label htmlFor={`${id}-filas`}>Filas<input id={`${id}-filas`} type="number" min="1" max={MAXIMO_DIMENSION}
        value={valor.filas} onChange={e => dimension("filas", e.target.value)} /></label>
      <label htmlFor={`${id}-columnas`}>Columnas<input id={`${id}-columnas`} type="number" min="1" max={MAXIMO_DIMENSION}
        value={valor.columnas} onChange={e => dimension("columnas", e.target.value)} /></label>
    </div>
    <p>{valor.filas} × {valor.columnas} · {valor.zonas.length} zonas. Cambiar dimensiones restablece el acomodo en serpentina.</p>
    <Cuadricula filas={valor.filas} columnas={valor.columnas} zonas={valor.zonas} actual={0}
      completas={[]} ejecutando={false} onReordenar={bloqueado ? undefined : zonas => onChange({ ...valor, zonas })} />
  </fieldset>;
}
