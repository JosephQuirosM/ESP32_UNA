import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, symlinkSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import express from "express";
import { rutasPreparacion } from "../src/preparacion.js";
import { ErrorPeticion } from "../src/gestor.js";
import { RaicesAutorizadas } from "../src/raicesAutorizadas.js";

test("Preparación HTTP: Python real, descarga y rechazo de entradas inválidas", async () => {
  const raiz = mkdtempSync(join(tmpdir(), "preparacion-web-"));
  const repo = existsSync(resolve("python")) ? resolve(".") : resolve("..");
  symlinkSync(join(repo, "python"), join(raiz, "python"), "dir");
  const app = express();
  app.use("/api/preparacion", rutasPreparacion({ raiz, directorioDatos: raiz, python: "python3", host: "127.0.0.1", puertoHttp: 8080, puertoUdp: 4210, destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof ErrorPeticion ? error.estadoHttp : 500).json({ error: error.message }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/preparacion`;
  const cabecera = "timestamp_utc_pc,sesion_gateway,jugador_id,sesion_jugador,secuencia,mac_torre,rssi\n";
  const csv = cabecera + ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"].map((mac) => `2026-10-16T00:00:00Z,1,1,1,7,${mac},-50\n`).join("");
  const archivo = { nombre: "zona12.csv", zona: 12, dataset: "dataset 1", contenido: csv };
  const post = (archivos: unknown[], directorioSalida = raiz, nombreSalida?: string) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivos, directorioSalida, nombreSalida }) });
  try {
    const response = await post([archivo]);
    assert.equal(response.status, 201);
    const result = await response.json() as { id: string; resumen: { vectores_completos: number }; zonas: number[] };
    assert.equal(result.resumen.vectores_completos, 1);
    assert.deepEqual(result.zonas, [12]);
    const download = await fetch(`${url}/${result.id}/csv`);
    assert.equal(download.status, 200);
    assert.match(await download.text(), /,12,dataset 1,zona12.csv,/);
    const sinDataset = await post([{ nombre: "papa.csv", zona: 4, contenido: csv }]);
    assert.equal(sinDataset.status, 201);
    assert.equal((await post([archivo, archivo])).status, 400);
    assert.equal((await post([{ ...archivo, nombre: "../peligro.csv" }])).status, 400);
    assert.equal((await post([{ ...archivo, contenido: "rssi\n-50" }])).status, 400);
    assert.equal((await fetch(`${url}/invalido/csv`)).status, 404);
    const destino = join(raiz, "mis resultados");
    mkdirSync(destino);
    writeFileSync(join(destino, "dataset_etiquetado.csv"), "no sobrescribir");
    const exportacion = await post([archivo], destino);
    assert.equal(exportacion.status, 201);
    const exportado = await exportacion.json() as {rutaSalida: string};
    assert.equal(exportado.rutaSalida, join(destino, "dataset_etiquetado_2.csv"));
    assert.equal(readFileSync(join(destino, "dataset_etiquetado.csv"), "utf8"), "no sobrescribir");
    assert.match(readFileSync(exportado.rutaSalida, "utf8"), /,12,dataset 1,zona12.csv,/);
    assert.ok(existsSync(join(destino, "dataset_etiquetado_2.json")));
    writeFileSync(join(destino, "Entrenamiento cancha.json"), "resumen anterior");
    const personalizada = await post([archivo], destino, "Entrenamiento cancha.CSV");
    assert.equal(personalizada.status, 201);
    const nuevo = await personalizada.json() as { rutaSalida: string; nombre: string; id: string };
    assert.equal(nuevo.nombre, "Entrenamiento cancha_2.csv");
    assert.equal(nuevo.rutaSalida, join(destino, nuevo.nombre));
    assert.ok(existsSync(nuevo.rutaSalida));
    assert.ok(existsSync(join(destino, "Entrenamiento cancha_2.json")));
    assert.equal(readFileSync(join(destino, "Entrenamiento cancha.json"), "utf8"), "resumen anterior");
    assert.equal(existsSync(join(destino, "Entrenamiento cancha.csv")), false);
    for (const [tipo, extension] of [["csv", "csv"], ["resumen", "json"]]) {
      const descarga = await fetch(`${url}/${nuevo.id}/${tipo}`);
      assert.equal(descarga.status, 200);
      assert.equal(descarga.headers.get("content-disposition"), `attachment; filename="Entrenamiento cancha_2.${extension}"`);
      await descarga.text();
    }
    for (const invalido of ["", "../externo", "carpeta\\archivo", "CON.csv", "a".repeat(81)]) {
      assert.equal((await post([archivo], destino, invalido)).status, 400);
    }
    assert.equal((await post([archivo], join(raiz, "inexistente"))).status, 400);
    assert.equal((await fetch(`${url}/seleccionar-carpeta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta: join(raiz, "inexistente") }) })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("Preparación toma CSV de la raíz autorizada sin descargarlos al celular", async () => {
  const base = mkdtempSync(join(tmpdir(), "preparacion-raiz-"));
  const repo = existsSync(resolve("python")) ? resolve(".") : resolve("..");
  symlinkSync(join(repo, "python"), join(base, "python"), "dir");
  const trabajo = join(base, "trabajo"), fuera = join(base, "fuera");
  mkdirSync(trabajo); mkdirSync(fuera);
  const cabecera = "timestamp_utc_pc,sesion_gateway,jugador_id,sesion_jugador,secuencia,mac_torre,rssi\n";
  const csv = cabecera + ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"].map(mac => `2026-10-16T00:00:00Z,1,1,1,7,${mac},-50\n`).join("");
  const entrada = join(trabajo, "zona_1.csv"), externa = join(fuera, "externa.csv");
  writeFileSync(entrada, csv); writeFileSync(externa, csv);
  symlinkSync(externa, join(trabajo, "enlace.csv"));
  const seguridad = new RaicesAutorizadas(base);
  seguridad.agregar(trabajo);
  const app = express();
  app.use("/api/preparacion", rutasPreparacion({ raiz: base, directorioDatos: base, python: "python3", host: "127.0.0.1", puertoHttp: 8080, puertoUdp: 4210, destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" }, seguridad));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof ErrorPeticion ? error.estadoHttp : 500).json({ error: error.message }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/preparacion`;
  const post = (ruta: string) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archivos: [{ ruta, zona: 1 }], directorioSalida: trabajo }) });
  try {
    const valida = await post(entrada);
    assert.equal(valida.status, 201);
    const salida = await valida.json() as { rutaSalida: string; resumen: { vectores_completos: number } };
    assert.equal(salida.resumen.vectores_completos, 1);
    assert.match(readFileSync(salida.rutaSalida, "utf8"), /zona_1\.csv/);
    assert.equal((await post(externa)).status, 201);
    for (const ruta of [externa, join(trabajo, "enlace.csv")]) {
      const respuesta = await fetch(url, { method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://otro-sitio.test" },
        body: JSON.stringify({ archivos: [{ ruta, zona: 1 }], directorioSalida: trabajo }) });
      assert.equal(respuesta.status, 403);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});
