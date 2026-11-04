import { validarCuadricula, type GeometriaCuadricula } from "../../shared/cuadricula.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { mkdir, rm, realpath, stat, open, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { Router, json } from "express";
import type { Configuracion } from "./gestor.js";
import { ErrorPeticion } from "./gestor.js";
import { seleccionarCarpeta } from "./selectorCarpeta.js";

/** Reserva nombres libres sin sobrescribir resultados de preparaciones anteriores. */
async function exportar(carpeta: string, origen: string): Promise<string> {
  for (let numero = 1; numero < 10000; numero++) {
    const nombre = `dataset_etiquetado${numero === 1 ? "" : `_${numero}`}`;
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
export function rutasPreparacion(config: Configuracion) {
  const router = Router();
  const base = join(config.raiz, "data/processed/preparaciones");
  function verificarAccesoLocal(direccion: string | undefined) {
    const locales = new Set(["127.0.0.1", "::1", ...Object.values(networkInterfaces()).flatMap((entradas) => (entradas ?? []).map((entrada) => entrada.address))]);
    if (!direccion || !locales.has(direccion.replace(/^::ffff:/, "")))
      throw new ErrorPeticion(403, "La selección de carpetas está disponible desde esta PC.");
  }
  function rutaElegida(valor: unknown) {
    if (typeof valor !== "string" || !valor.trim() || valor.includes("\0"))
      throw new ErrorPeticion(400, "Indica una ruta de carpeta válida.");
    return isAbsolute(valor.trim()) ? valor.trim() : resolve(config.raiz, valor.trim());
  }
  let selectorAbierto = false;
  router.post("/seleccionar-carpeta", json({ limit: "2kb" }), async (req, res) => {
    verificarAccesoLocal(req.socket.remoteAddress);
    if (selectorAbierto) throw new ErrorPeticion(409, "Ya hay un selector de carpetas abierto en esta PC.");
    const inicial = req.body?.ruta ? rutaElegida(req.body.ruta) : config.raiz;
    try {
      if (!(await stat(inicial)).isDirectory()) throw new Error();
    } catch { throw new ErrorPeticion(400, "La carpeta inicial no existe. Corrige la ruta o déjala vacía."); }
    selectorAbierto = true;
    try { res.json({ ruta: await seleccionarCarpeta(inicial) }); }
    finally { selectorAbierto = false; }
  });
  router.post("/", json({ limit: "32mb" }), async (req, res) => {
    let cuadricula: GeometriaCuadricula | undefined;
    if (req.body?.cuadricula !== undefined) {
      try { cuadricula = validarCuadricula(req.body.cuadricula); }
      catch (e) { throw new ErrorPeticion(400, (e as Error).message); }
    }
    const archivos = req.body?.archivos;
    if (!Array.isArray(archivos) || !archivos.length || archivos.length > 200)
      throw new ErrorPeticion(400, "Selecciona entre 1 y 200 archivos CSV.");
    for (const a of archivos) {
      if (!a || typeof a.nombre !== "string" || !/^[^/\\\x00-\x1f]{1,240}\.csv$/i.test(a.nombre) ||
          typeof a.contenido !== "string" || !Number.isSafeInteger(a.zona) || a.zona < 1 ||
          (a.dataset !== undefined && (typeof a.dataset !== "string" || a.dataset.length > 120)))
        throw new ErrorPeticion(400, "Cada CSV necesita un nombre válido, una zona positiva.");
    }
    const nombres = archivos.map((a) => a.nombre.toLowerCase());
    if (new Set(nombres).size !== nombres.length)
      throw new ErrorPeticion(400, "Hay archivos con el mismo nombre; elimina el duplicado o renómbralo.");
    let destino: string | undefined;
    if (req.body?.directorioSalida !== undefined && req.body.directorioSalida !== "") {
      verificarAccesoLocal(req.socket.remoteAddress);
      destino = rutaElegida(req.body.directorioSalida);
      try {
        destino = await realpath(destino);
        if (!(await stat(destino)).isDirectory()) throw new Error();
      } catch { throw new ErrorPeticion(400, "La carpeta de salida no existe o no es accesible."); }
    }
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
      let rutaSalida = join(carpeta, "dataset_etiquetado.csv");
      if (destino) {
        try { rutaSalida = await exportar(destino, carpeta); }
        catch { throw new ErrorPeticion(400, "No se pudo guardar en la carpeta elegida. Revisa los permisos de escritura."); }
      }
      res.status(201).json({ rutaSalida, id, nombre: "dataset_etiquetado.csv", descarga: `/api/preparacion/${id}/csv`, resumenDescarga: `/api/preparacion/${id}/resumen`, ...JSON.parse(resultado) });
    } catch (error) {
      await rm(carpeta, { recursive: true, force: true });
      throw error;
    }
  });
  router.get("/:id/:tipo", (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(req.params.id) ||
        !["csv", "resumen"].includes(req.params.tipo))
      throw new ErrorPeticion(404, "Archivo no encontrado.");
    const nombre = req.params.tipo === "csv" ? "dataset_etiquetado.csv" : "dataset_etiquetado.json";
    const ruta = join(base, req.params.id, nombre);
    if (!existsSync(ruta)) throw new ErrorPeticion(404, "Archivo no encontrado.");
    res.download(ruta, nombre);
  });
  return router;
}
