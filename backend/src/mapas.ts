import { validarCuadricula, type GeometriaCuadricula } from "../../shared/cuadricula.js";
import { Router, json } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, basename } from "node:path";
import { seleccionarArchivosLocales } from "./selectorCarpeta.js";
import { ErrorPeticion, type Configuracion } from "./gestor.js";
import { recordarRutas } from "./rutasPreferidas.js";
import type { RaicesAutorizadas } from "./raicesAutorizadas.js";
import { puedeUsarRutasLocales, restriccionesDeRutas } from "./accesoLocal.js";

type Mapa = { indice: number; rutaImagen: string | null; rutaLecturas?: string; tieneMapa?: boolean; rutaPredicciones: string; rutaResumen: string; [clave: string]: unknown };
export function rutasMapas(config: Configuracion, seguridad?: RaicesAutorizadas) {
  const router = Router();
  const base = join(config.raiz, "data/processed/mapas_web");
  let ocupado: string | null = null, selectorAbierto = false;
  router.use(json({ limit: "64kb" }));
  function ruta(valor: unknown) {
    if (typeof valor !== "string" || !valor.trim() || valor.includes("\0")) throw new ErrorPeticion(400, "Selecciona una ruta válida.");
    return isAbsolute(valor.trim()) ? valor.trim() : resolve(config.raiz, valor.trim());
  }
  async function archivo(valor: unknown, extension: string) {
    const elegido = ruta(valor);
    if (!elegido.toLowerCase().endsWith(extension)) throw new ErrorPeticion(400, `Selecciona un archivo ${extension}.`);
    try { const real = await realpath(elegido); const info = await stat(real); if (!info.isFile()) throw new Error(); if (info.size > 100*1024*1024) throw new ErrorPeticion(400, "Cada archivo debe ocupar como máximo 100 MB."); return { ruta:real, bytes:info.size }; }
    catch (e) { if (e instanceof ErrorPeticion) throw e; throw new ErrorPeticion(400, `No se puede leer ${basename(elegido)}.`); }
  }
  function validarId(id: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new ErrorPeticion(404, "Generación no encontrada."); }
  async function estadoTrabajo(id: string) {
    validarId(id);
    try { return JSON.parse(await readFile(join(base,id,"estado.json"),"utf8")); }
    catch { throw new ErrorPeticion(404,"Generación no encontrada."); }
  }
  async function exigirSolicitudAutorizada(id: string, restricciones?: RaicesAutorizadas) {
    if (!restricciones) return;
    const solicitud = JSON.parse(await readFile(join(base, id, "solicitud.json"), "utf8"));
    solicitud.entradas.forEach((ruta: string) => restricciones.permitir(ruta, "archivo"));
    restricciones.permitir(solicitud.modelo, "archivo");
    restricciones.permitir(solicitud.directorioSalida, "carpeta");
  }
  router.post("/seleccionar",async(req,res)=>{
    if (!puedeUsarRutasLocales(req)) throw new ErrorPeticion(403, "El selector nativo sólo se abre desde esta PC.");
    if (!["csv","joblib"].includes(req.body?.tipo)) throw new ErrorPeticion(400,"Tipo de archivo inválido.");
    if (selectorAbierto) throw new ErrorPeticion(409,"Ya hay un selector de archivos abierto.");
    selectorAbierto=true;
    try { res.json({ archivos: await seleccionarArchivosLocales(config.raiz, req.body.tipo) }); }
    finally { selectorAbierto=false; }
  });
  router.post("/",async(req,res)=>{
    const restricciones = restriccionesDeRutas(req, seguridad);
    const anterior=ocupado;
    if (anterior) { try { const previo=await estadoTrabajo(anterior); if (["completado","error"].includes(previo.estado) && ocupado===anterior) ocupado=null; } catch { /* Sigue iniciando. */ } }
    if (ocupado) throw new ErrorPeticion(409,"Hay una generación de mapas en curso.");
    let cuadricula: GeometriaCuadricula | undefined;
    if (req.body?.cuadricula !== undefined) {
      try { cuadricula = validarCuadricula(req.body.cuadricula); }
      catch (e) { throw new ErrorPeticion(400, (e as Error).message); }
    }
    const nombre=req.body?.nombre, ventana=req.body?.ventana;
    if (typeof nombre!=="string" || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nombre)) throw new ErrorPeticion(400,"El nombre debe tener entre 1 y 80 letras, números, espacios o guiones.");
    if (!Number.isSafeInteger(ventana) || ventana<1 || ventana>1000) throw new ErrorPeticion(400,"El suavizado debe ser un entero entre 1 y 1000.");
    if (!Array.isArray(req.body?.entradas) || !req.body.entradas.length || req.body.entradas.length>50) throw new ErrorPeticion(400,"Selecciona entre 1 y 50 CSV.");
    const entradas=[]; let bytes=0;
    for (const valor of req.body.entradas) { const f=await archivo(valor,".csv"); restricciones?.permitir(f.ruta, "archivo"); entradas.push(f.ruta); bytes+=f.bytes; }
    if (new Set(entradas).size!==entradas.length) throw new ErrorPeticion(400,"Hay archivos CSV repetidos.");
    if (bytes>200*1024*1024) throw new ErrorPeticion(400,"Los CSV no deben superar 200 MB en total.");
    const modelo=(await archivo(req.body.modelo,".joblib")).ruta;
    restricciones?.permitir(modelo, "archivo");
    if (!req.body.directorioSalida) throw new ErrorPeticion(400,"Selecciona una carpeta de salida para los mapas.");
    let directorioSalida:string;
    try { directorioSalida=await realpath(ruta(req.body.directorioSalida)); if (!(await stat(directorioSalida)).isDirectory()) throw new Error(); } catch { throw new ErrorPeticion(400,"La carpeta de salida no existe o no es accesible."); }
    restricciones?.permitir(directorioSalida, "carpeta");
    if (ocupado) throw new ErrorPeticion(409,"Hay una generación de mapas en curso.");
    const id=randomUUID(), carpeta=join(base,id); ocupado=id;
    try {
      await mkdir(carpeta,{recursive:true});
      await writeFile(join(carpeta,"solicitud.json"),JSON.stringify({entradas,modelo,nombre,directorioSalida,ventana,cuadricula}));
      try { recordarRutas(config.directorioDatos, { mapasEntradas: entradas, mapasModelo: modelo, mapasSalida: directorioSalida }); } catch (error) { console.error("No se pudieron recordar las rutas de mapas:", error); }
      await writeFile(join(carpeta,"estado.json"),JSON.stringify({estado:"pendiente",mapas:[],procesados:0,total:entradas.length}));
      const child=spawn(config.python,["-B",join(config.raiz,"python/mapas_calor_web.py"),join(carpeta,"solicitud.json")],{cwd:config.raiz,stdio:["ignore","ignore","pipe"],env:{...process.env,MPLBACKEND:"Agg"}});
      let stderr=""; child.stderr.on("data",c=>{stderr=(stderr+c).slice(-4000);});
      const fallo=async(error:string)=>{ const previo=await estadoTrabajo(id).catch(()=>({mapas:[],procesados:0,total:entradas.length})); await writeFile(join(carpeta,"estado.json"),JSON.stringify({...previo,estado:"error",error})).catch(()=>{}); };
      const timer=setTimeout(()=>{child.kill();void fallo("La generación excedió el límite de 15 minutos.");},900000);
      child.on("error",()=>{clearTimeout(timer);if(ocupado===id)ocupado=null;void fallo("No se pudo iniciar Python para generar mapas.");});
      child.on("close",code=>{clearTimeout(timer);if(ocupado===id)ocupado=null;if(code!==0)void fallo(stderr.trim()||"La generación se interrumpió.");});
      if(child.pid)await writeFile(join(carpeta,"pid.json"),JSON.stringify({pid:child.pid}));
      res.status(202).json({id,estado:"pendiente",mapas:[],procesados:0,total:entradas.length});
    } catch(e){if(ocupado===id)ocupado=null;throw e;}
  });
  router.get("/:id",async(req,res)=>{
    let estado=await estadoTrabajo(req.params.id);
    const carpeta=join(base,req.params.id);
    if(["pendiente","generando"].includes(estado.estado)) { try{ const {pid}=JSON.parse(await readFile(join(carpeta,"pid.json"),"utf8"));process.kill(pid,0); }catch{estado={...estado,estado:"error",error:"El proceso de generación ya no está disponible."};} }
    const solicitud=JSON.parse(await readFile(join(carpeta,"solicitud.json"),"utf8"));
    await exigirSolicitudAutorizada(req.params.id, restriccionesDeRutas(req, seguridad));
    res.json({id:req.params.id,...solicitud,...estado,
      resumenGeneralCsv:estado.rutaResumenGeneralCsv ? `/api/mapas/${req.params.id}/resumen/csv` : undefined,
      resumenGeneralJson:estado.rutaResumenGeneralJson ? `/api/mapas/${req.params.id}/resumen/json` : undefined,
      mapas:estado.mapas.map((m:Mapa)=>({...m,imagen:m.tieneMapa===false ? null : `/api/mapas/${req.params.id}/archivo/${m.indice}/imagen`,descarga:m.tieneMapa===false ? null : `/api/mapas/${req.params.id}/archivo/${m.indice}/png`,lecturas:m.rutaLecturas ? `/api/mapas/${req.params.id}/archivo/${m.indice}/lecturas` : undefined,predicciones:`/api/mapas/${req.params.id}/archivo/${m.indice}/csv`,resumenDescarga:`/api/mapas/${req.params.id}/archivo/${m.indice}/json`}))});
  });
  router.get("/:id/resumen/:tipo",async(req,res)=>{
    const estado=await estadoTrabajo(req.params.id);
    await exigirSolicitudAutorizada(req.params.id, restriccionesDeRutas(req, seguridad));
    const tipo=req.params.tipo;
    const destino=tipo==="csv"?estado.rutaResumenGeneralCsv:tipo==="json"?estado.rutaResumenGeneralJson:null;
    if(!destino)throw new ErrorPeticion(404,"Resumen no encontrado.");
    res.download(join(base,req.params.id,`resumen_general.${tipo}`),basename(destino));
  });
  router.get("/:id/archivo/:indice/:tipo",async(req,res)=>{
    const estado=await estadoTrabajo(req.params.id);
    await exigirSolicitudAutorizada(req.params.id, restriccionesDeRutas(req, seguridad));
    if(!/^\d+$/.test(req.params.indice))throw new ErrorPeticion(404,"Mapa no encontrado.");
    const mapa=estado.mapas.find((m:Mapa)=>m.indice===Number(req.params.indice));
    if(!mapa)throw new ErrorPeticion(404,"Mapa no encontrado.");
    const tipo=req.params.tipo;
    if ((tipo==="png" || tipo==="imagen") && mapa.tieneMapa===false) throw new ErrorPeticion(404,"Este jugador no tiene vectores completos para generar el mapa.");
    if (tipo==="lecturas" && !mapa.rutaLecturas) throw new ErrorPeticion(404,"Lecturas no disponibles para este resultado anterior.");
    const extension=tipo==="png"||tipo==="imagen"?"png":(tipo==="csv" || tipo==="lecturas")?"csv":tipo==="json"?"json":null;
    if(!extension)throw new ErrorPeticion(404,"Archivo no encontrado.");
    const path=join(base,req.params.id,`mapa_${mapa.indice}${tipo==="lecturas"?"_lecturas":""}.${extension}`);
    if(tipo==="imagen")res.sendFile(path);
    else res.download(path,basename(tipo==="png"?mapa.rutaImagen!:tipo==="lecturas"?mapa.rutaLecturas!:tipo==="csv"?mapa.rutaPredicciones:mapa.rutaResumen));
  });
  return router;
}
