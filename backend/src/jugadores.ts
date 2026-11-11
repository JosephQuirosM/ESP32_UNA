import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Router, json } from "express";
import { ErrorPeticion, type Configuracion } from "./gestor.js";
import { peticionLocal } from "./accesoLocal.js";
import { seleccionarCsv } from "./selectorCarpeta.js";
import { recordarRutas } from "./rutasPreferidas.js";
import type { RaicesAutorizadas } from "./raicesAutorizadas.js";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Resultado = { indice: number; rutaLecturas: string; [clave: string]: unknown };

/** Separa las lecturas con el mismo procesamiento por jugador que usa Mapas. */
export function rutasJugadores(config: Configuracion, seguridad?: RaicesAutorizadas) {
  const router = Router();
  const base = join(config.raiz, "data/processed/preparaciones_jugadores");
  let ocupado: string | null = null;
  let selectorAbierto = false;
  router.use(json({ limit: "4kb" }));

  function ruta(valor: unknown) {
    if (typeof valor !== "string" || !valor.trim() || valor.includes("\0")) throw new ErrorPeticion(400, "Selecciona una ruta válida.");
    return isAbsolute(valor.trim()) ? valor.trim() : resolve(config.raiz, valor.trim());
  }
  function carpetaTrabajo(id: string) {
    if (!ID.test(id)) throw new ErrorPeticion(404, "Separación no encontrada.");
    return join(base, id);
  }
  async function estadoTrabajo(id: string) {
    try { return JSON.parse(await readFile(join(carpetaTrabajo(id), "estado.json"), "utf8")); }
    catch (error) { if (error instanceof ErrorPeticion) throw error; throw new ErrorPeticion(404, "Separación no encontrada."); }
  }
  async function solicitudTrabajo(id: string) {
    try { return JSON.parse(await readFile(join(carpetaTrabajo(id), "solicitud.json"), "utf8")); }
    catch (error) { if (error instanceof ErrorPeticion) throw error; throw new ErrorPeticion(404, "Separación no encontrada."); }
  }
  async function autorizar(id: string) {
    const solicitud = await solicitudTrabajo(id);
    if (seguridad) {
      seguridad.permitir(solicitud.entrada, "archivo");
      seguridad.permitir(solicitud.directorioSalida, "carpeta");
    }
    return solicitud;
  }

  router.post("/seleccionar", async (req, res) => {
    if (!peticionLocal(req)) throw new ErrorPeticion(403, "El selector nativo sólo se abre desde esta PC.");
    if (selectorAbierto) throw new ErrorPeticion(409, "Ya hay un selector de archivos abierto.");
    selectorAbierto = true;
    try {
      const elegido = await seleccionarCsv(config.raiz, "Seleccionar CSV de lecturas por jugador");
      if (elegido) seguridad?.permitir(elegido, "archivo");
      res.json({ ruta: elegido });
    } finally { selectorAbierto = false; }
  });

  router.post("/", async (req, res) => {
    if (ocupado) {
      try { if (["completado", "error"].includes((await estadoTrabajo(ocupado)).estado)) ocupado = null; }
      catch { /* El trabajo sigue arrancando. */ }
    }
    if (ocupado) throw new ErrorPeticion(409, "Hay una separación de jugadores en curso.");
    const nombre = req.body?.nombre;
    if (typeof nombre !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nombre))
      throw new ErrorPeticion(400, "El nombre debe tener entre 1 y 80 letras, números, espacios o guiones.");
    const entrada = ruta(req.body?.entrada);
    if (!entrada.toLowerCase().endsWith(".csv")) throw new ErrorPeticion(400, "Selecciona un archivo .csv.");
    let entradaReal: string, salidaReal: string;
    try {
      entradaReal = await realpath(entrada);
      const info = await stat(entradaReal);
      if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) throw new Error();
    } catch { throw new ErrorPeticion(400, "El CSV no existe, está vacío o supera 100 MB."); }
    try {
      salidaReal = await realpath(ruta(req.body?.directorioSalida));
      if (!(await stat(salidaReal)).isDirectory()) throw new Error();
    } catch { throw new ErrorPeticion(400, "La carpeta de salida no existe o no es accesible."); }
    seguridad?.permitir(entradaReal, "archivo");
    seguridad?.permitir(salidaReal, "carpeta");
    const id = randomUUID();
    const carpeta = carpetaTrabajo(id);
    ocupado = id;
    try {
      await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, "solicitud.json"), JSON.stringify({ entrada: entradaReal, directorioSalida: salidaReal, nombre }));
      await writeFile(join(carpeta, "estado.json"), JSON.stringify({ estado: "pendiente", total: 1, procesados: 0, jugadoresProcesados: 0, jugadores: [] }));
      try { recordarRutas(config.directorioDatos, { jugadoresEntrada: entradaReal, jugadoresSalida: salidaReal }); }
      catch (error) { console.error("No se pudieron recordar las rutas de jugadores:", error); }
      const child = spawn(config.python, ["-B", join(config.raiz, "python/separar_jugadores_web.py"), join(carpeta, "solicitud.json")],
        { cwd: config.raiz, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", fragmento => { stderr = (stderr + fragmento).slice(-4000); });
      const fallo = async (mensaje: string) => {
        const anterior = await estadoTrabajo(id).catch(() => ({ total: 1, procesados: 0, jugadoresProcesados: 0, jugadores: [] }));
        if (anterior.estado !== "completado") await writeFile(join(carpeta, "estado.json"), JSON.stringify({ ...anterior, estado: "error", error: mensaje })).catch(() => {});
      };
      const limite = setTimeout(() => { child.kill(); void fallo("La separación excedió el límite de 5 minutos."); }, 300000);
      child.on("error", () => { clearTimeout(limite); if (ocupado === id) ocupado = null; void fallo("No se pudo iniciar Python para separar jugadores."); });
      child.on("close", codigo => { clearTimeout(limite); if (ocupado === id) ocupado = null; if (codigo !== 0) void fallo(stderr.trim() || "La separación se interrumpió."); });
      if (child.pid) await writeFile(join(carpeta, "pid.json"), JSON.stringify({ pid: child.pid }));
      res.status(202).json({ id, estado: "pendiente", total: 1, procesados: 0, jugadoresProcesados: 0, jugadores: [] });
    } catch (error) { if (ocupado === id) ocupado = null; throw error; }
  });

  router.get("/:id", async (req, res) => {
    let estado = await estadoTrabajo(req.params.id);
    const carpeta = carpetaTrabajo(req.params.id);
    if (["pendiente", "procesando"].includes(estado.estado)) {
      try { const { pid } = JSON.parse(await readFile(join(carpeta, "pid.json"), "utf8")); process.kill(pid, 0); }
      catch { estado = { ...estado, estado: "error", error: "El proceso de separación ya no está disponible." }; }
    }
    const solicitud = await autorizar(req.params.id);
    res.json({ id: req.params.id, ...solicitud, ...estado,
      resumenGeneralCsv: estado.rutaResumenGeneralCsv ? `/api/preparacion/jugadores/${req.params.id}/resumen/csv` : undefined,
      resumenGeneralJson: estado.rutaResumenGeneralJson ? `/api/preparacion/jugadores/${req.params.id}/resumen/json` : undefined,
      jugadores: estado.jugadores.map((j: Resultado) => ({ ...j, descarga: `/api/preparacion/jugadores/${req.params.id}/archivo/${j.indice}` })) });
  });
  router.get("/:id/resumen/:tipo", async (req, res) => {
    const estado = await estadoTrabajo(req.params.id);
    await autorizar(req.params.id);
    const rutaResumen = req.params.tipo === "csv" ? estado.rutaResumenGeneralCsv : req.params.tipo === "json" ? estado.rutaResumenGeneralJson : null;
    if (!rutaResumen) throw new ErrorPeticion(404, "Resumen no encontrado.");
    seguridad?.permitir(rutaResumen, "archivo");
    res.download(rutaResumen, basename(rutaResumen));
  });
  router.get("/:id/archivo/:indice", async (req, res) => {
    const estado = await estadoTrabajo(req.params.id);
    await autorizar(req.params.id);
    if (!/^\d+$/.test(req.params.indice)) throw new ErrorPeticion(404, "Jugador no encontrado.");
    const jugador = estado.jugadores.find((j: Resultado) => j.indice === Number(req.params.indice));
    if (!jugador) throw new ErrorPeticion(404, "Jugador no encontrado.");
    seguridad?.permitir(jugador.rutaLecturas, "archivo");
    res.download(jugador.rutaLecturas, basename(jugador.rutaLecturas));
  });
  return router;
}
