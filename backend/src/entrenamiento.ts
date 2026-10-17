import { Router, json } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { mkdir, readFile, writeFile, stat, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, basename } from "node:path";
import { seleccionarCsv } from "./selectorCarpeta.js";
import { ErrorPeticion, type Configuracion } from "./gestor.js";

export function rutasEntrenamiento(config: Configuracion) {
  const router = Router();
  const base = join(config.raiz, "models/entrenamientos");
  const script = join(config.raiz, "python/entrenamiento_web.py");
  let ocupado: string | null = null;
  let selectorAbierto = false;
  router.use((req, _res, next) => {
    const locales = new Set(["127.0.0.1", "::1", ...Object.values(networkInterfaces()).flatMap(v => (v ?? []).map(a => a.address))]);
    if (!req.socket.remoteAddress || !locales.has(req.socket.remoteAddress.replace(/^::ffff:/, "")))
      throw new ErrorPeticion(403, "El entrenamiento con archivos locales está disponible desde esta PC.");
    next();
  });
  router.use(json({ limit: "16kb" }));
  function ruta(valor: unknown) {
    if (typeof valor !== "string" || !valor.trim() || valor.includes("\0")) throw new ErrorPeticion(400, "Selecciona un archivo o carpeta válido.");
    return isAbsolute(valor.trim()) ? valor.trim() : resolve(config.raiz, valor.trim());
  }
  async function entrada(valor: unknown) {
    const archivo = ruta(valor);
    if (!/\.csv$/i.test(archivo)) throw new ErrorPeticion(400, "Selecciona un archivo .csv etiquetado.");
    try {
      const real = await realpath(archivo), info = await stat(real);
      if (!info.isFile()) throw new Error();
      if (info.size > 100 * 1024 * 1024) throw new ErrorPeticion(400, "El CSV supera el límite de 100 MB.");
      return real;
    } catch (e) { if (e instanceof ErrorPeticion) throw e; throw new ErrorPeticion(400, "No se puede leer el CSV seleccionado."); }
  }
  async function inspeccionar(archivo: string) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(config.python, ["-B", script, "inspeccionar", archivo], { cwd: config.raiz, stdio: ["ignore", "pipe", "pipe"] });
      let salida = "", error = "";
      const timer = setTimeout(() => { child.kill(); reject(new ErrorPeticion(504, "La revisión del CSV excedió el tiempo disponible.")); }, 30000);
      child.stdout.on("data", c => { salida += c; }); child.stderr.on("data", c => { error = (error+c).slice(-4000); });
      child.on("error", () => { clearTimeout(timer); reject(new ErrorPeticion(503, "No se pudo iniciar Python. Revisa el entorno y requirements.txt.")); });
      child.on("close", code => { clearTimeout(timer); if (code !== 0) reject(new ErrorPeticion(400, error.trim() || "CSV etiquetado inválido.")); else { try { resolve(JSON.parse(salida)); } catch { reject(new ErrorPeticion(500, "Python devolvió un resultado inválido.")); } } });
    });
  }
  router.post("/seleccionar-csv", async (_req, res) => {
    if (selectorAbierto) throw new ErrorPeticion(409, "Ya hay un selector de archivos abierto.");
    selectorAbierto = true;
    try { res.json({ ruta: await seleccionarCsv(config.raiz) }); }
    finally { selectorAbierto = false; }
  });
  router.post("/inspeccionar", async (req, res) => {
    const archivo = await entrada(req.body?.entrada);
    res.json({ entrada: archivo, ...await inspeccionar(archivo) });
  });
  router.post("/", async (req, res) => {
    // Python publica el resultado antes de terminar de cerrar el proceso.
    // Una tarea completada ya permite iniciar la siguiente sin un 409 transitorio.
    const anterior = ocupado;
    if (anterior) {
      try {
        const previo = JSON.parse(await readFile(join(base, anterior, "estado.json"), "utf8"));
        if (["completado", "error"].includes(previo.estado) && ocupado === anterior) ocupado = null;
      } catch { /* La tarea puede estar todavía revisando la entrada. */ }
    }
    if (ocupado) throw new ErrorPeticion(409, "Hay un entrenamiento en curso. Espera a que termine.");
    const algoritmo = req.body?.algoritmo, p = req.body?.parametros ?? {};
    if (!["knn", "random_forest"].includes(algoritmo) || !p || typeof p !== "object" || Array.isArray(p)) throw new ErrorPeticion(400, "Selecciona KNN o Random Forest y parámetros válidos.");
    const nombre = req.body?.nombre;
    if (typeof nombre !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(nombre)) throw new ErrorPeticion(400, "El nombre debe tener entre 1 y 80 letras, números, guiones o guiones bajos.");
    let directorioSalida = join(config.raiz, "models");
    if (req.body.directorioSalida) {
      try { directorioSalida = await realpath(ruta(req.body.directorioSalida)); if (!(await stat(directorioSalida)).isDirectory()) throw new Error(); }
      catch { throw new ErrorPeticion(400, "La carpeta de salida no existe o no es accesible."); }
    }
    const archivo = await entrada(req.body.entrada);
    const entero = (clave: string, min: number, max: number) => { if (!Number.isSafeInteger(p[clave]) || p[clave] < min || p[clave] > max) throw new ErrorPeticion(400, `Parámetro ${clave}: debe ser un entero entre ${min} y ${max}.`); };
    if (algoritmo === "knn") {
      entero("k", 1, 1000000);
      if (!["distance", "uniform"].includes(p.pesos) || !["euclidean", "manhattan"].includes(p.distancia) || typeof p.normalizar !== "boolean") throw new ErrorPeticion(400, "Configuración KNN inválida.");
    } else {
      entero("arboles", 1, 2000); entero("min_division", 2, 1000); entero("min_hoja", 1, 1000); entero("semilla", 0, 2147483647);
      if (p.profundidad !== null) entero("profundidad", 1, 100);
    }
    if (ocupado) throw new ErrorPeticion(409, "Hay un entrenamiento en curso. Espera a que termine.");
    const id = randomUUID(), carpeta = join(base, id);
    ocupado = id;
    try {
      const resumen = await inspeccionar(archivo);
      if (algoritmo === "knn" && p.k > Number(resumen.vectores_completos)) throw new ErrorPeticion(400, "K no puede superar la cantidad de vectores completos.");
      await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, "solicitud.json"), JSON.stringify({ entrada: archivo, algoritmo, parametros: p, nombre, directorioSalida, resumen }));
      await writeFile(join(carpeta, "estado.json"), JSON.stringify({ estado: "pendiente" }));
      const child = spawn(config.python, ["-B", script, "entrenar", join(carpeta, "solicitud.json")], { cwd: config.raiz, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", c => { stderr = (stderr+c).slice(-4000); });
      const fallo = async (mensaje: string) => {
        await writeFile(join(carpeta, "estado.json"), JSON.stringify({ estado: "error", error: mensaje })).catch(() => {});
      };
      const timer = setTimeout(() => { child.kill(); void fallo("El entrenamiento excedió el límite de 15 minutos."); }, 900000);
      child.on("error", () => { clearTimeout(timer); if (ocupado === id) ocupado = null; void fallo("No se pudo iniciar Python para entrenar."); });
      child.on("close", code => { clearTimeout(timer); if (ocupado === id) ocupado = null; if (code !== 0) void fallo(stderr.trim() || "El entrenamiento se interrumpió."); });
      if (child.pid) await writeFile(join(carpeta, "pid.json"), JSON.stringify({ pid: child.pid }));
      res.status(202).json({ id, estado: "pendiente" });
    } catch (e) { if (ocupado === id) ocupado = null; throw e; }
  });
  function validarId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new ErrorPeticion(404, "Entrenamiento no encontrado.");
  }
  router.get("/:id", async (req, res) => {
    validarId(req.params.id);
    const carpeta = join(base, req.params.id);
    let estado;
    try { estado = JSON.parse(await readFile(join(carpeta, "estado.json"), "utf8")); }
    catch { throw new ErrorPeticion(404, "Entrenamiento no encontrado."); }
    if (["pendiente", "entrenando"].includes(estado.estado)) {
      try { const { pid } = JSON.parse(await readFile(join(carpeta, "pid.json"), "utf8")); process.kill(pid, 0); }
      catch { estado = { estado: "error", error: "El proceso de entrenamiento ya no está disponible. Puedes volver a iniciarlo." }; }
    }
    const solicitud = JSON.parse(await readFile(join(carpeta, "solicitud.json"), "utf8"));
    res.json({ id: req.params.id, ...solicitud, ...estado, descarga: `/api/entrenamiento/${req.params.id}/modelo`, resumenDescarga: `/api/entrenamiento/${req.params.id}/resumen` });
  });
  router.get("/:id/:tipo", async (req, res) => {
    validarId(req.params.id);
    const nombre = req.params.tipo === "modelo" ? "modelo.joblib" : req.params.tipo === "resumen" ? "modelo.json" : null;
    if (!nombre) throw new ErrorPeticion(404, "Archivo no encontrado.");
    const carpeta = join(base, req.params.id);
    let estado;
    try { estado = JSON.parse(await readFile(join(carpeta, "estado.json"), "utf8")); }
    catch { throw new ErrorPeticion(404, "Entrenamiento no encontrado."); }
    if (estado.estado !== "completado") throw new ErrorPeticion(409, "El modelo todavía no está listo.");
    res.download(join(carpeta, nombre), basename(req.params.tipo === "modelo" ? estado.rutaModelo : estado.rutaResumen));
  });
  return router;
}
