import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, symlinkSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { rutasEntrenamiento } from "../src/entrenamiento.js";
import { ErrorPeticion, type Configuracion } from "../src/gestor.js";

const repo = existsSync(resolve("python")) ? resolve(".") : resolve("..");
const python = join(repo, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
test("Entrenamiento web con Python: KNN, RF, persistencia, descarga y validación", { skip: !existsSync(python) }, async () => {
  const raiz = mkdtempSync(join(tmpdir(), "entrenamiento-web-"));
  symlinkSync(join(repo, "python"), join(raiz, "python"), "dir");
  const entrada = join(raiz, "lecturas.csv");
  writeFileSync(entrada, "rssi_sup_izq,rssi_sup_der,rssi_inf_izq,rssi_inf_der,zona,completo\n-40,-41,-42,-43,4,1\n-41,-40,-43,-42,4,1\n-70,-71,-72,-73,12,1\n-71,-70,-73,-72,12,1\n,-40,-40,-40,4,0\n");
  const cfg: Configuracion = { raiz, directorioDatos:raiz, python, host:"127.0.0.1", puertoHttp:8080, puertoUdp:4210, destinoUdp:"127.0.0.1", zonaHoraria:"America/Costa_Rica" };
  const app=express(); app.use("/api/entrenamiento",rutasEntrenamiento(cfg));
  app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error instanceof ErrorPeticion?error.estadoHttp:500).json({error:error.message});});
  const server=app.listen(0,"127.0.0.1"); await new Promise<void>(resolve=>server.on("listening",resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/entrenamiento`;
  const post=(ruta:string,body:unknown)=>fetch(url+ruta,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  try {
    const revision=await post("/inspeccionar",{entrada}); assert.equal(revision.status,200);
    assert.equal((await revision.json() as {vectores_completos:number}).vectores_completos,4);
    assert.equal((await post("/inspeccionar",{entrada:join(raiz,"no.csv")})).status,400);
    assert.equal((await post("",{entrada,algoritmo:"knn",nombre:"invalido",parametros:{k:99,pesos:"distance",distancia:"euclidean",normalizar:true}})).status,400);
    for (const algoritmo of ["knn","random_forest"]) {
      const parametros=algoritmo==="knn"?{k:1,pesos:"distance",distancia:"euclidean",normalizar:true}:{arboles:8,profundidad:null,min_division:2,min_hoja:1,semilla:42};
      const response=await post("",{entrada,algoritmo,nombre:"mi_modelo",directorioSalida:raiz,parametros}); assert.equal(response.status,202);
      const {id}=await response.json() as {id:string};
      let result:Record<string,unknown>={};
      const limite=Date.now()+30000;
      do {
        result=await (await fetch(`${url}/${id}`)).json() as Record<string,unknown>;
        if (["completado","error"].includes(String(result.estado))) break;
        await new Promise(r=>setTimeout(r,100));
      } while(Date.now()<limite);
      assert.equal(result.estado,"completado",JSON.stringify(result));
      assert.ok(existsSync(String(result.rutaModelo)));
      assert.equal(JSON.parse(readFileSync(String(result.rutaResumen),"utf8")).evaluacion,null);
      const download=await fetch(`${url}/${id}/modelo`); assert.equal(download.status,200); assert.ok((await download.arrayBuffer()).byteLength>100);
      assert.equal((await fetch(`${url}/${id}/resumen`)).status,200);
    }
    assert.ok(existsSync(join(raiz,"mi_modelo.joblib"))); assert.ok(existsSync(join(raiz,"mi_modelo_2.joblib")));
    assert.equal((await fetch(`${url}/invalido`)).status,404);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); rmSync(raiz,{recursive:true,force:true}); }
});
