import { Router, json } from "express";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { mkdir, readFile, writeFile, stat, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, basename } from "node:path";
import { seleccionarArchivosLocales } from "./selectorCarpeta.js";
import { ErrorPeticion, type Configuracion } from "./gestor.js";

type Mapa = { indice: number; rutaImagen: string; rutaPredicciones: string; rutaResumen: string; [clave: string]: unknown };
export function rutasMapas(config: Configuracion) {
  const router = Router();
  const base = join(config.raiz, "data/processed/mapas_web");
  let ocupado: string | null = null, selectorAbierto = false;
  router.use((req, _res, next) => {
    const locales = new Set(["127.0.0.1", "::1", ...Object.values(networkInterfaces()).flatMap(v => (v ?? []).map(a => a.address))]);
    if (!req.socket.remoteAddress || !locales.has(req.socket.remoteAddress.replace(/^::ffff:/, ""))) throw new ErrorPeticion(403, "Los mapas con archivos locales están disponibles desde esta PC.");
    next();
  });
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
  router.post("/seleccionar",async(req,res)=>{
    if (!["csv","joblib"].includes(req.body?.tipo)) throw new ErrorPeticion(400,"Tipo de archivo inválido.");
    if (selectorAbierto) throw new ErrorPeticion(409,"Ya hay un selector de archivos abierto.");
    selectorAbierto=true;
    try { res.json({ archivos:await seleccionarArchivosLocales(config.raiz,req.body.tipo) }); }
    finally { selectorAbierto=false; }
  });
  router.post("/",async(req,res)=>{
    const anterior=ocupado;
    if (anterior) { try { const previo=await estadoTrabajo(anterior); if (["completado","error"].includes(previo.estado) && ocupado===anterior) ocupado=null; } catch { /* Sigue iniciando. */ } }
    if (ocupado) throw new ErrorPeticion(409,"Hay una generación de mapas en curso.");
    const nombre=req.body?.nombre, ventana=req.body?.ventana;
    if (typeof nombre!=="string" || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,79}$/u.test(nombre)) throw new ErrorPeticion(400,"El nombre debe tener entre 1 y 80 letras, números, espacios o guiones.");
    if (!Number.isSafeInteger(ventana) || ventana<1 || ventana>1000) throw new ErrorPeticion(400,"El suavizado debe ser un entero entre 1 y 1000.");
    if (!Array.isArray(req.body?.entradas) || !req.body.entradas.length || req.body.entradas.length>50) throw new ErrorPeticion(400,"Selecciona entre 1 y 50 CSV.");
    const entradas=[]; let bytes=0;
    for (const valor of req.body.entradas) { const f=await archivo(valor,".csv"); entradas.push(f.ruta); bytes+=f.bytes; }
    if (new Set(entradas).size!==entradas.length) throw new ErrorPeticion(400,"Hay archivos CSV repetidos.");
    if (bytes>200*1024*1024) throw new ErrorPeticion(400,"Los CSV no deben superar 200 MB en total.");
    const modelo=(await archivo(req.body.modelo,".joblib")).ruta;
    let directorioSalida=join(config.raiz,"data/processed/mapas");
    if (req.body.directorioSalida) { try { directorioSalida=await realpath(ruta(req.body.directorioSalida)); if (!(await stat(directorioSalida)).isDirectory()) throw new Error(); } catch { throw new ErrorPeticion(400,"La carpeta de salida no existe o no es accesible."); } }
    else await mkdir(directorioSalida,{recursive:true});
    if (ocupado) throw new ErrorPeticion(409,"Hay una generación de mapas en curso.");
    const id=randomUUID(), carpeta=join(base,id); ocupado=id;
    try {
      await mkdir(carpeta,{recursive:true});
      await writeFile(join(carpeta,"solicitud.json"),JSON.stringify({entradas,modelo,nombre,directorioSalida,ventana}));
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
    res.json({id:req.params.id,...solicitud,...estado,mapas:estado.mapas.map((m:Mapa)=>({...m,imagen:`/api/mapas/${req.params.id}/archivo/${m.indice}/imagen`,descarga:`/api/mapas/${req.params.id}/archivo/${m.indice}/png`,predicciones:`/api/mapas/${req.params.id}/archivo/${m.indice}/csv`,resumenDescarga:`/api/mapas/${req.params.id}/archivo/${m.indice}/json`}))});
  });
  router.get("/:id/archivo/:indice/:tipo",async(req,res)=>{
    const estado=await estadoTrabajo(req.params.id);
    if(!/^\d+$/.test(req.params.indice))throw new ErrorPeticion(404,"Mapa no encontrado.");
    const mapa=estado.mapas.find((m:Mapa)=>m.indice===Number(req.params.indice));
    if(!mapa)throw new ErrorPeticion(404,"Mapa no encontrado.");
    const tipo=req.params.tipo;
    const extension=tipo==="png"||tipo==="imagen"?"png":tipo==="csv"?"csv":tipo==="json"?"json":null;
    if(!extension)throw new ErrorPeticion(404,"Archivo no encontrado.");
    const path=join(base,req.params.id,`mapa_${mapa.indice}.${extension}`);
    if(tipo==="imagen")res.sendFile(path);
    else res.download(path,basename(tipo==="png"?mapa.rutaImagen:tipo==="csv"?mapa.rutaPredicciones:mapa.rutaResumen));
  });
  return router;
}
