import { validarCuadricula, type GeometriaCuadricula } from "../../shared/cuadricula.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, realpath, stat, open, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve, isAbsolute } from "node:path";
import { Router, json } from "express";
import type { Configuracion } from "./gestor.js";
import { ErrorPeticion } from "./gestor.js";
import { seleccionarCarpeta } from "./selectorCarpeta.js";
import { recordarRutas } from "./rutasPreferidas.js";
import type { RaicesAutorizadas } from "./raicesAutorizadas.js";
import { writeFile, readFile } from "node:fs/promises";
import { puedeUsarRutasLocales, restriccionesDeRutas } from "./accesoLocal.js";

const NOMBRE_PREDETERMINADO = "dataset_etiquetado";

function nombreDataset(valor: unknown): string {
  if (valor === undefined) return NOMBRE_PREDETERMINADO;
  if (typeof valor !== "string") throw new ErrorPeticion(400, "Indica un nombre de archivo válido.");
  const nombre = valor.trim().replace(/\.csv$/i, "");
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._-]{0,79}$/u.test(nombre) || /[. ]$/.test(nombre) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]) *(?:\.|$)/i.test(nombre))
    throw new ErrorPeticion(400, "Usa entre 1 y 80 caracteres para el nombre, empezando por una letra o un número. Puedes usar espacios, guiones, guiones bajos y puntos interiores.");
  return nombre;
}

/** Reserva nombres libres sin sobrescribir resultados de preparaciones anteriores. */
async function exportar(carpeta: string, origen: string, nombreBase: string): Promise<string> {
  for (let numero = 1; numero < 10000; numero++) {
    const nombre = `${nombreBase}${numero === 1 ? "" : `_${numero}`}`;
    const csv = join(carpeta, `${nombre}.csv`), json = join(carpeta, `${nombre}.json`);
    try { await (await open(csv, "wx")).close(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") continue; throw e; }
    try { await (await open(json, "wx")).close(); }
    catch (e) {
      await rm(csv, { force: true });
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
    try {
      await copyFile(join(origen, "dataset_etiquetado.csv"), csv);
      await copyFile(join(origen, "dataset_etiquetado.json"), json);
      return csv;
    } catch (e) { await Promise.all([rm(csv, { force: true }), rm(json, { force: true })]); throw e; }
  }
  throw new Error("No se pudo reservar un nombre de salida disponible.");
}

/** Ejecuta el agrupado Python y exporta el resultado a la carpeta elegida. */
export function rutasPreparacion(config: Configuracion, seguridad?: RaicesAutorizadas) {
  const router = Router();
  const base = join(config.raiz, "data/processed/preparaciones");
  function rutaElegida(valor: unknown) {
    if (typeof valor !== "string" || !valor.trim() || valor.includes("\0"))
      throw new ErrorPeticion(400, "Indica una ruta de carpeta válida.");
    return isAbsolute(valor.trim()) ? valor.trim() : resolve(config.raiz, valor.trim());
  }
  let selectorAbierto = false;
  router.post(["/seleccionar-carpeta", "/jugadores/seleccionar-carpeta"], json({ limit: "2kb" }), async (req, res) => {
    if (!puedeUsarRutasLocales(req)) throw new ErrorPeticion(403, "La selección de carpetas está disponible desde esta PC.");
    if (selectorAbierto) throw new ErrorPeticion(409, "Ya hay un selector de carpetas abierto en esta PC.");
    const inicial = req.body?.ruta ? rutaElegida(req.body.ruta) : config.raiz;
    try {
      if (!(await stat(inicial)).isDirectory()) throw new Error();
    } catch { throw new ErrorPeticion(400, "La carpeta inicial no existe. Corrige la ruta o déjala vacía."); }
    selectorAbierto = true;
    try {
      res.json({ ruta: await seleccionarCarpeta(inicial) });
    } finally { selectorAbierto = false; }
  });
  router.post("/", json({ limit: "32mb" }), async (req, res) => {
    const restricciones = restriccionesDeRutas(req, seguridad);
    const nombreSalida = nombreDataset(req.body?.nombreSalida);
    let cuadricula: GeometriaCuadricula | undefined;
    if (req.body?.cuadricula !== undefined) {
      try { cuadricula = validarCuadricula(req.body.cuadricula); }
      catch (e) { throw new ErrorPeticion(400, (e as Error).message); }
    }
    const seleccion = req.body?.archivos;
    if (!Array.isArray(seleccion) || !seleccion.length || seleccion.length > 200)
      throw new ErrorPeticion(400, "Selecciona entre 1 y 200 archivos CSV.");
    const archivos: { nombre: string; contenido: string; zona: number; dataset?: string }[] = [];
    let bytes = 0;
    for (const a of seleccion) {
      if (!a || !Number.isSafeInteger(a.zona) || a.zona < 1 ||
          (a.dataset !== undefined && (typeof a.dataset !== "string" || a.dataset.length > 120)))
        throw new ErrorPeticion(400, "Cada CSV necesita una zona positiva.");
      let nombre: string, contenido: string;
      if (a.ruta !== undefined) {
        if ((!restricciones && !puedeUsarRutasLocales(req)) || typeof a.ruta !== "string" || a.contenido !== undefined || a.nombre !== undefined)
          throw new ErrorPeticion(400, "Selecciona una ruta de CSV válida.");
        const ruta = restricciones ? restricciones.permitir(a.ruta, "archivo") : rutaElegida(a.ruta);
        nombre = ruta.split(/[\\/]/).at(-1) ?? "";
        const info = await stat(ruta).catch(() => null);
        if (!info?.isFile()) throw new ErrorPeticion(400, "No se puede leer el CSV seleccionado.");
        const tamano = info.size;
        if (!tamano || bytes + tamano > 28 * 1024 * 1024)
          throw new ErrorPeticion(400, "El límite es de 28 MB entre todos los CSV.");
        contenido = await readFile(ruta, "utf8");
      } else {
        nombre = a.nombre;
        contenido = a.contenido;
      }
      if (typeof nombre !== "string" || !/^[^/\\\x00-\x1f]{1,240}\.csv$/i.test(nombre) || typeof contenido !== "string")
        throw new ErrorPeticion(400, "Cada archivo debe ser un CSV válido.");
      bytes += Buffer.byteLength(contenido, "utf8");
      if (!contenido || bytes > 28 * 1024 * 1024)
        throw new ErrorPeticion(400, "El límite es de 28 MB entre todos los CSV.");
      archivos.push({ nombre, contenido, zona: a.zona, ...(a.dataset !== undefined ? { dataset: a.dataset } : {}) });
    }
    const nombres = archivos.map((a) => a.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length)
      throw new ErrorPeticion(400, "Hay archivos con el mismo nombre; elimina el duplicado o renómbralo.");
    if (!req.body?.directorioSalida) throw new ErrorPeticion(400, "Selecciona una carpeta de salida antes de preparar los CSV.");
    let destino = rutaElegida(req.body.directorioSalida);
    try {
      destino = await realpath(destino);
      if (!(await stat(destino)).isDirectory()) throw new Error();
    } catch { throw new ErrorPeticion(400, "La carpeta de salida no existe o no es accesible."); }
    restricciones?.permitir(destino, "carpeta");
    const id = randomUUID();
    const carpeta = join(base, id);
    await mkdir(carpeta, { recursive: true });
    try {
      const resultado = await new Promise<string>((resolve, reject) => {
        const child = spawn(config.python, ["-B", join(config.raiz, "python/preparar_datos_web.py"), join(carpeta, "dataset_etiquetado.csv")], {
          cwd: config.raiz, stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "", stderr = "";
        const timer = setTimeout(() => { child.kill(); reject(new ErrorPeticion(504, "La preparación excedió el tiempo disponible.")); }, 120000);
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
        child.on("error", () => { clearTimeout(timer); reject(new ErrorPeticion(503, "No se pudo iniciar Python. Revisa la configuración del servidor.")); });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new ErrorPeticion(400, stderr.trim() || "No se pudieron preparar los CSV."));
          else resolve(stdout);
        });
        child.stdin.on("error", () => { /* La salida del proceso informa el error. */ });
        child.stdin.end(JSON.stringify({ archivos, cuadricula }));
      });
      let rutaSalida: string;
      try { rutaSalida = await exportar(destino, carpeta, nombreSalida); }
      catch { throw new ErrorPeticion(400, "No se pudo guardar en la carpeta elegida. Revisa los permisos de escritura."); }
      await writeFile(join(carpeta, "autorizacion.json"), JSON.stringify({ rutaSalida }));
      try { recordarRutas(config.directorioDatos, { preparacionSalida: destino }); } catch (error) { console.error("No se pudo recordar la carpeta de preparación:", error); }
      res.status(201).json({ rutaSalida, id, nombre: basename(rutaSalida), descarga: `/api/preparacion/${id}/csv`, resumenDescarga: `/api/preparacion/${id}/resumen`, ...JSON.parse(resultado) });
    } catch (error) {
      await rm(carpeta, { recursive: true, force: true });
      throw error;
    }
  });
  router.get("/:id/:tipo", async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params.id) ||
        !["csv", "resumen"].includes(req.params.tipo))
      throw new ErrorPeticion(404, "Archivo no encontrado.");
    const extension = req.params.tipo === "csv" ? ".csv" : ".json";
    const carpeta = join(base, req.params.id);
    const ruta = join(carpeta, NOMBRE_PREDETERMINADO + extension);
    let salida: string | undefined;
    try {
      const rutaSalida = JSON.parse(await readFile(join(carpeta, "autorizacion.json"), "utf8")).rutaSalida;
      if (typeof rutaSalida === "string") salida = rutaSalida;
    }
    catch { /* Los resultados antiguos pueden no tener metadatos de exportación. */ }
    const restricciones = restriccionesDeRutas(req, seguridad);
    if (restricciones && !salida) throw new ErrorPeticion(403, "El resultado antiguo no tiene una carpeta autorizada.");
    if (salida) restricciones?.permitir(salida, "archivo");
    if (!existsSync(ruta)) throw new ErrorPeticion(404, "Archivo no encontrado.");
    res.download(ruta, (salida ? basename(salida, ".csv") : NOMBRE_PREDETERMINADO) + extension);
  });
  return router;
}
