import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ErrorPeticion } from "./gestor.js";

export interface RaizAutorizada { id: string; ruta: string; nombre: string }
const ID = /^[0-9a-f-]{36}$/i;

/** Única fuente de autoridad para rutas visibles desde la red privada. */
export class RaicesAutorizadas {
  private readonly archivo: string;
  private raices: RaizAutorizada[] = [];

  constructor(directorioDatos: string) {
    this.archivo = join(directorioDatos, ".config", "raices-autorizadas.json");
    if (existsSync(this.archivo)) {
      const guardado: unknown = JSON.parse(readFileSync(this.archivo, "utf8"));
      if (!Array.isArray(guardado) || !guardado.every((r) => r && typeof r.id === "string" && ID.test(r.id) && typeof r.ruta === "string" && isAbsolute(r.ruta)))
        throw new Error("La configuración de carpetas autorizadas es inválida.");
      this.raices = guardado.map((r) => ({ id: r.id, ruta: r.ruta, nombre: basename(r.ruta) || r.ruta }));
    }
  }

  listar() { return this.raices.filter((r) => { try { return statSync(r.ruta).isDirectory() && realpathSync(r.ruta) === r.ruta; } catch { return false; } }); }

  private guardar() {
    mkdirSync(dirname(this.archivo), { recursive: true });
    writeFileSync(`${this.archivo}.tmp`, JSON.stringify(this.raices, null, 2), { mode: 0o600 });
    renameSync(`${this.archivo}.tmp`, this.archivo);
  }

  agregar(valor: unknown): RaizAutorizada {
    if (typeof valor !== "string" || !isAbsolute(valor) || valor.includes("\0")) throw new ErrorPeticion(400, "Elige una carpeta absoluta de esta PC.");
    let ruta: string;
    try { ruta = realpathSync(valor); if (!statSync(ruta).isDirectory()) throw new Error(); }
    catch { throw new ErrorPeticion(400, "La carpeta no existe o no se puede abrir."); }
    if (dirname(ruta) === ruta) throw new ErrorPeticion(400, "Elige una carpeta de trabajo, no la raíz completa del disco.");
    if (this.raices.some((r) => r.ruta === ruta)) throw new ErrorPeticion(409, "Esta carpeta ya está autorizada.");
    const raiz = { id: randomUUID(), ruta, nombre: basename(ruta) || ruta };
    this.raices.push(raiz); this.guardar(); return raiz;
  }

  quitar(id: string) {
    const anterior = this.raices.length;
    this.raices = this.raices.filter((r) => r.id !== id);
    if (anterior === this.raices.length) throw new ErrorPeticion(404, "Carpeta autorizada no encontrada.");
    this.guardar();
  }

  /** Resuelve enlaces antes de comparar y evita el error de prefijos entre carpetas hermanas. */
  permitir(valor: unknown, tipo: "archivo" | "carpeta" | "cualquiera" = "cualquiera"): string {
    if (typeof valor !== "string" || !isAbsolute(valor) || valor.includes("\0")) throw new ErrorPeticion(403, "La ruta debe estar dentro de una carpeta autorizada.");
    let ruta: string;
    try {
      ruta = realpathSync(valor);
      const info = statSync(ruta);
      if (tipo === "archivo" && !info.isFile()) throw new Error();
      if (tipo === "carpeta" && !info.isDirectory()) throw new Error();
    } catch { throw new ErrorPeticion(403, "La ruta no existe o no está autorizada."); }
    if (!this.listar().some((r) => {
      const resto = relative(r.ruta, ruta);
      return resto === "" || (resto !== ".." && !resto.startsWith(`..${sep}`) && !isAbsolute(resto));
    })) throw new ErrorPeticion(403, "La ruta está fuera de las carpetas autorizadas.");
    return ruta;
  }

  /** El navegador recibe únicamente nombres y rutas dentro del perímetro aprobado. */
  explorar(id: string, rutaRelativa: unknown = "") {
    const raiz = this.listar().find((r) => r.id === id);
    if (!raiz) throw new ErrorPeticion(404, "Carpeta autorizada no disponible.");
    if (typeof rutaRelativa !== "string" || rutaRelativa.includes("\0") || isAbsolute(rutaRelativa)) throw new ErrorPeticion(400, "Ruta relativa inválida.");
    const carpeta = this.permitir(resolve(raiz.ruta, rutaRelativa), "carpeta");
    const resto = relative(raiz.ruta, carpeta);
    if (resto === ".." || resto.startsWith(`..${sep}`) || isAbsolute(resto)) throw new ErrorPeticion(403, "Fuera de la carpeta autorizada.");
    const elementos = readdirSync(carpeta, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).flatMap((e) => {
      try {
        const ruta = this.permitir(join(carpeta, e.name));
        const info = statSync(ruta);
        if (!info.isDirectory() && !info.isFile()) return [];
        return [{ nombre: e.name, ruta, relativa: relative(raiz.ruta, ruta), tipo: info.isDirectory() ? "carpeta" : "archivo", tamano: info.isFile() ? info.size : null }];
      } catch { return []; }
    }).sort((a, b) => a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre) : a.tipo === "carpeta" ? -1 : 1);
    return { raiz, carpeta, actual: resto, elementos };
  }

  crearCarpeta(id: string, rutaRelativa: unknown, nombre: unknown) {
    if (typeof nombre !== "string" || nombre.length > 80 || !nombre || nombre.startsWith(".") ||
        /[<>:"/\\|?*\x00-\x1f]/.test(nombre) || /[. ]$/.test(nombre) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(nombre))
      throw new ErrorPeticion(400, "Elige un nombre de carpeta sin puntos iniciales ni caracteres reservados.");
    const actual = this.explorar(id, rutaRelativa);
    const nueva = join(actual.carpeta, nombre);
    try { mkdirSync(nueva, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ErrorPeticion(409, "Ya existe una carpeta o archivo con ese nombre.");
      throw new ErrorPeticion(400, "No se pudo crear la carpeta. Revisa los permisos de escritura.");
    }
    const ruta = this.permitir(nueva, "carpeta");
    return { nombre, ruta, relativa: relative(actual.raiz.ruta, ruta), tipo: "carpeta" as const };
  }
}
