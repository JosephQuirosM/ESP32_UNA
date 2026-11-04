export { dimensionValida, generarZonas, MAXIMO_DIMENSION } from "../../shared/cuadricula";
export type { GeometriaCuadricula } from "../../shared/cuadricula";
export const DIMENSIONES_INICIALES = { filas: 3, columnas: 3 };

/** Intercambia posiciones visuales conservando los identificadores de zona. */
export function intercambiarZonas(
  zonas: number[],
  origen: number,
  destino: number,
): number[] {
  const desde = zonas.indexOf(origen),
    hasta = zonas.indexOf(destino);
  if (desde < 0 || hasta < 0 || desde === hasta) return zonas;
  const resultado = [...zonas];
  [resultado[desde], resultado[hasta]] = [resultado[hasta], resultado[desde]];
  return resultado;
}
