import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import express from "express";
import { rutasMapas } from "../src/mapas.js";
import { ErrorPeticion,type Configuracion } from "../src/gestor.js";
const repo=existsSync(resolve("python"))?resolve("."):resolve("..");
const python=join(repo,process.platform==="win32"?".venv/Scripts/python.exe":".venv/bin/python");
test("Mapas HTTP: lote de CSV, imagen real, exportación y validación",{skip:!existsSync(python)},async()=>{
 const raiz=mkdtempSync(join(tmpdir(),"mapas-web-"));symlinkSync(join(repo,"python"),join(raiz,"python"),"dir");
 const a=join(raiz,"a.csv"),b=join(raiz,"b.csv"),modelo=join(raiz,"modelo.joblib");
 const csv="rssi_sup_izq,rssi_sup_der,rssi_inf_izq,rssi_inf_der,completo\n-50,-51,-52,-53,1\n-51,-52,-53,-54,1\n";writeFileSync(a,csv);writeFileSync(b,csv);
 assert.equal(spawnSync(python,["-c","import joblib,sys;from sklearn.dummy import DummyClassifier;joblib.dump(DummyClassifier(strategy='constant',constant=5).fit([[-50]*4],[5]),sys.argv[1])",modelo]).status,0);
 const cfg:Configuracion={raiz,directorioDatos:raiz,python,host:"127.0.0.1",puertoHttp:8080,puertoUdp:4210,destinoUdp:"127.0.0.1",zonaHoraria:"America/Costa_Rica"};
 const app=express();app.use("/api/mapas",rutasMapas(cfg));app.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(e instanceof ErrorPeticion?e.estadoHttp:500).json({error:e.message});});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.on("listening",r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/mapas`;
 const carga={entradas:[a,b],modelo,nombre:"mis mapas",ventana:5,directorioSalida:raiz};
 const post=(body:unknown)=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 try{
  assert.equal((await post({...carga,ventana:0})).status,400);
  assert.equal((await post({...carga,modelo:a})).status,400);
  assert.equal((await post({...carga,entradas:[a,a]})).status,400);
  const respuesta=await post(carga);assert.equal(respuesta.status,202);const {id}=await respuesta.json() as {id:string};
  let estado:{estado?:string;mapas?:{indice:number;rutaImagen:string;imagen:string;descarga:string}[];error?:string}={};
  const limite=Date.now()+30000;
  do{estado=await (await fetch(`${url}/${id}`)).json();if(["completado","error"].includes(estado.estado??""))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<limite);
  assert.equal(estado.estado,"completado",JSON.stringify(estado));assert.equal(estado.mapas?.length,2);
  for(const mapa of estado.mapas??[]){
   assert.ok(existsSync(mapa.rutaImagen));const preview=await fetch(`${url}/${id}/archivo/${mapa.indice}/imagen`);assert.equal(preview.status,200);assert.match(preview.headers.get("content-type")??"",/image\/png/);assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(1,4).toString(),"PNG");
   assert.equal((await fetch(`${url}/${id}/archivo/${mapa.indice}/csv`)).status,200);assert.equal((await fetch(`${url}/${id}/archivo/${mapa.indice}/json`)).status,200);
  }
  // La API publica las lecturas intactas y ambos resúmenes generales.
  for(const mapa of estado.mapas??[]){
   const lecturas=await fetch(`${url}/${id}/archivo/${mapa.indice}/lecturas`);
   assert.equal(lecturas.status,200);assert.equal(await lecturas.text(),csv.replace(/\n/g,"\r\n"));
  }
  assert.equal((await fetch(`${url}/${id}/resumen/csv`)).status,200);
  assert.equal((await fetch(`${url}/${id}/resumen/json`)).status,200);
  assert.equal((await fetch(`${url}/${id}/resumen/no-valido`)).status,404);
  const macs=["10:06:1C:D5:95:04","90:15:06:5A:30:D0","10:06:1C:D5:95:8C","10:06:1C:D4:8F:C4"];
  const crudo="timestamp_utc_pc,sesion_gateway,jugador_id,sesion_jugador,secuencia,torre_id,mac_torre,rssi\n"+
   [...macs.map((mac,i)=>`2026-11-04T00:00:00Z,1,1,7,1,${i+1},${mac},-50`),
    `2026-11-04T00:00:00Z,1,2,8,1,1,${macs[0]},-55`].join("\n")+"\n";
  writeFileSync(a,crudo);
  const segunda=await post({...carga,entradas:[a]});assert.equal(segunda.status,202);
  const id2=(await segunda.json() as {id:string}).id;
  let multi:any;
  do{multi=await (await fetch(`${url}/${id2}`)).json();if(["completado","error"].includes(multi.estado))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<limite);
  assert.equal(multi.estado,"completado",JSON.stringify(multi));assert.equal(multi.mapas.length,2);
  assert.equal(multi.procesados,1);assert.equal(multi.mapasGenerados,1);
  const incompleto=multi.mapas.find((m:any)=>m.jugadorId===2);
  assert.equal(incompleto.imagen,null);assert.equal(incompleto.descarga,null);
  assert.equal((await fetch(`${url}/${id2}/archivo/${incompleto.indice}/imagen`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}${incompleto.lecturas}`)).status,200);
  const resumen=await (await fetch(`${url}/${id2}/resumen/json`)).json() as any;
  assert.equal(resumen.jugadores[0].recepcion_porcentaje,100);
  assert.equal(resumen.jugadores[1].recepcion_porcentaje,25);
  assert.equal(resumen.jugadores[1].vectores_completos_porcentaje,0);
  const recuperado=await (await fetch(`${url}/${id2}`)).json() as any;
  assert.deepEqual(recuperado.mapas,multi.mapas);
  assert.equal((await fetch(`${url}/${id}/archivo/99/imagen`)).status,404);
  assert.equal((await fetch(`${url}/invalido`)).status,404);
 }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(raiz,{recursive:true,force:true});}
});
