import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ClaveRuta = "recoleccionSalida" | "preparacionSalida" | "entrenamientoEntrada" |
  "entrenamientoSalida" | "mapasEntradas" | "mapasModelo" | "mapasSalida" | "jugadoresEntrada" | "jugadoresSalida";
export type RutasPreferidas = Partial<Record<ClaveRuta, string | string[]>>;
const CLAVES: ClaveRuta[] = ["recoleccionSalida", "preparacionSalida", "entrenamientoEntrada",
  "entrenamientoSalida", "mapasEntradas", "mapasModelo", "mapasSalida", "jugadoresEntrada", "jugadoresSalida"];

function archivo(directorioDatos: string) { return join(directorioDatos, ".config", "rutas-preferidas.json"); }

export function leerRutasPreferidas(directorioDatos: string): RutasPreferidas {
  try {
    const guardado = JSON.parse(readFileSync(archivo(directorioDatos), "utf8")) as Record<string, unknown>;
    const rutas: RutasPreferidas = {};
    for (const clave of CLAVES) {
      const valor = guardado[clave];
      if (clave === "mapasEntradas") {
        if (Array.isArray(valor) && valor.every(r => typeof r === "string" && existsSync(r))) rutas[clave] = valor;
      } else if (typeof valor === "string" && existsSync(valor)) rutas[clave] = valor;
    }
    return rutas;
  } catch { return {}; }
}

export function recordarRutas(directorioDatos: string, cambios: RutasPreferidas) {
  const ruta = archivo(directorioDatos);
  const guardado = leerRutasPreferidas(directorioDatos);
  const siguiente = { ...guardado, ...cambios };
  mkdirSync(join(directorioDatos, ".config"), { recursive: true });
  writeFileSync(`${ruta}.tmp`, JSON.stringify(siguiente, null, 2));
  renameSync(`${ruta}.tmp`, ruta);
}
