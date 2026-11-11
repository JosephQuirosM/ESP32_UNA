import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { rutasJugadores } from "../src/jugadores.js";
import { ErrorPeticion, type Configuracion } from "../src/gestor.js";
import { RaicesAutorizadas } from "../src/raicesAutorizadas.js";

const repo = existsSync(resolve("python")) ? resolve(".") : resolve("..");
const python = join(repo, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"];

test("Preparación/Jugadores separa, ordena y descarga sin generar mapas", { skip: !existsSync(python) }, async () => {
  const raiz = mkdtempSync(join(tmpdir(), "jugadores-web-"));
  const externa = mkdtempSync(join(tmpdir(), "jugadores-externa-"));
  symlinkSync(join(repo, "python"), join(raiz, "python"), "dir");
  const entrada = join(raiz, "mezclado.csv");
  const ajena = join(externa, "ajena.csv");
  const cabecera = "timestamp_utc_pc,sesion_gateway,jugador_id,sesion_jugador,secuencia,torre_id,mac_torre,rssi,movimiento\n";
  const fila = (jugador: number, secuencia: number, torre: number, rssi: number) =>
    `2026-11-11T00:00:00Z,501,${jugador},7,${secuencia},${torre},${macs[torre - 1]},${rssi},Detenido`;
  const originales = [fila(1, 2, 2, -52), fila(2, 1, 1, -61), fila(1, 1, 4, -54),
    fila(1, 1, 1, -51), fila(1, 1, 2, -52), fila(1, 1, 3, -53), fila(1, 2, 2, -52)];
  writeFileSync(entrada, cabecera + originales.join("\n") + "\n");
  writeFileSync(ajena, cabecera + originales[0] + "\n");
  const cfg: Configuracion = { raiz, directorioDatos: raiz, python, host: "127.0.0.1", puertoHttp: 8080,
    puertoUdp: 4210, destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" };
  const seguridad = new RaicesAutorizadas(raiz);
  const autorizada = seguridad.agregar(raiz);
  const app = express();
  app.use("/api/preparacion/jugadores", rutasJugadores(cfg, seguridad));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ErrorPeticion ? error.estadoHttp : 500).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolver => server.on("listening", resolver));
  const origen = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = `${origen}/api/preparacion/jugadores`;
  const post = (carga: unknown) => fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(carga) });
  try {
    assert.equal((await post({ entrada: ajena, directorioSalida: raiz, nombre: "prueba" })).status, 403);
    const respuesta = await post({ entrada, directorioSalida: raiz, nombre: "prueba" });
    assert.equal(respuesta.status, 202);
    const { id } = await respuesta.json() as { id: string };
    let trabajo: any;
    const limite = Date.now() + 20000;
    do {
      trabajo = await (await fetch(`${api}/${id}`)).json();
      if (["completado", "error"].includes(trabajo.estado)) break;
      await new Promise(resolver => setTimeout(resolver, 100));
    } while (Date.now() < limite);
    assert.equal(trabajo.estado, "completado", JSON.stringify(trabajo));
    assert.equal(trabajo.jugadores.length, 2);
    const primero = trabajo.jugadores.find((item: any) => item.jugadorId === 1);
    const segundo = trabajo.jugadores.find((item: any) => item.jugadorId === 2);
    assert.deepEqual(readFileSync(primero.rutaLecturas, "utf8").trim().split(/\r?\n/).slice(1),
      [originales[3], originales[4], originales[5], originales[2], originales[0], originales[6]]);
    assert.equal(primero.estadisticas.total_recibido, 6);
    assert.equal(primero.estadisticas.duplicados, 1);
    assert.equal(primero.estadisticas.vectores_completos, 1);
    assert.equal(segundo.estadisticas.vectores_completos, 0);
    assert.equal((await fetch(`${origen}${primero.descarga}`)).status, 200);
    assert.equal((await fetch(`${origen}${segundo.descarga}`)).status, 200);
    assert.equal((await fetch(`${origen}${trabajo.resumenGeneralCsv}`)).status, 200);
    assert.equal((await fetch(`${origen}${trabajo.resumenGeneralJson}`)).status, 200);
    assert.equal((await fetch(`${api}/${id}/archivo/99`)).status, 404);
    assert.deepEqual((await (await fetch(`${api}/${id}`)).json()).jugadores, trabajo.jugadores);
    assert.equal(existsSync(join(raiz, "data/processed/preparaciones_jugadores", id, "mapa_0.png")), false);
    seguridad.quitar(autorizada.id);
    assert.equal((await fetch(`${origen}${primero.descarga}`)).status, 403);
  } finally {
    await new Promise<void>(resolver => server.close(() => resolver()));
    rmSync(raiz, { recursive: true, force: true });
    rmSync(externa, { recursive: true, force: true });
  }
});
