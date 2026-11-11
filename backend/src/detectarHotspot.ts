import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { join } from "node:path";

export interface Hotspot { interfaz: string; ip: string }

/** Consulta el hotspot que ya activó el usuario; no cambia la red ni requiere elevar permisos. */
export async function detectarHotspot(python: string, raiz: string): Promise<Hotspot | null> {
  return await new Promise(resolve => {
    execFile(python, ["-B", join(raiz, "python/detectar_hotspot.py")], { timeout: 6000 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const valor = JSON.parse(stdout) as Hotspot | null;
        if (!valor || typeof valor.interfaz !== "string" || isIP(valor.ip) !== 4 ||
            !Object.values(networkInterfaces()).some(direcciones => direcciones?.some(v =>
              v.family === "IPv4" && !v.internal && v.address === valor.ip))) return resolve(null);
        resolve(valor);
      } catch { resolve(null); }
    });
  });
}
