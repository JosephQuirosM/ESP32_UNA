/** Geometría visual: zonas en orden de celdas, de izquierda a derecha y arriba abajo. */
export interface GeometriaCuadricula {
  filas: number;
  columnas: number;
  zonas: number[];
}
export const MAXIMO_DIMENSION = 20;

export function dimensionValida(valor: number) {
  return Number.isInteger(valor) && valor >= 1 && valor <= MAXIMO_DIMENSION;
}

export function generarZonas(filas: number, columnas: number): number[] {
  if (!dimensionValida(filas) || !dimensionValida(columnas)) return [];
  return Array.from({ length: filas }, (_, fila) => {
    const zonas = Array.from({ length: columnas }, (_, columna) => fila * columnas + columna + 1);
    return fila % 2 ? zonas.reverse() : zonas;
  }).flat();
}

/** Valida dimensiones y una permutación completa de las zonas 1..N. */
export function validarCuadricula(valor: unknown): GeometriaCuadricula {
  if (!valor || typeof valor !== "object") throw new Error("Indica una cuadrícula válida.");
  const { filas, columnas, zonas } = valor as GeometriaCuadricula;
  if (!dimensionValida(filas) || !dimensionValida(columnas) || !Array.isArray(zonas) ||
      zonas.length !== filas * columnas || new Set(zonas).size !== zonas.length ||
      zonas.some(z => !Number.isInteger(z) || z < 1 || z > zonas.length))
    throw new Error("La cuadrícula requiere de 1 a 20 filas y columnas, y cada zona 1..N una sola vez.");
  return { filas, columnas, zonas: [...zonas] };
}
