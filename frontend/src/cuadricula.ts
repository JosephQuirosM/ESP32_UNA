export const DIMENSIONES_INICIALES = { filas: 3, columnas: 3 };
export const MAXIMO_DIMENSION = 20;

/** Comprueba las dimensiones antes de generar las zonas. */
export function dimensionValida(valor: number) {
  return Number.isInteger(valor) && valor >= 1 && valor <= MAXIMO_DIMENSION;
}

/** Genera la numeración inicial en serpentina para cualquier matriz válida. */
export function generarZonas(filas: number, columnas: number): number[] {
  if (!dimensionValida(filas) || !dimensionValida(columnas)) return [];
  return Array.from({ length: filas }, (_, fila) => {
    const zonas = Array.from(
      { length: columnas },
      (_, columna) => fila * columnas + columna + 1,
    );
    return fila % 2 ? zonas.reverse() : zonas;
  }).flat();
}

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
