import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { GestorLecturas } from "../src/gestor.js";
import { GatewaySimulado } from "./gatewaySimulado.js";

async function puertoLibre() {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise<void>(r => server.on("listening", r));
  const puerto = (server.address() as { port: number }).port;
  await new Promise<void>(r => server.close(() => r())); return puerto;
}
async function esperar<T>(leer: () => T, aceptar: (valor: T) => boolean, ms = 8000) {
  const plazo = Date.now() + ms;
  do {
    const valor = leer(); if (aceptar(valor)) return valor;
    await new Promise(r => setTimeout(r, 30));
  } while (Date.now() < plazo);
  assert.fail("El estado esperado no llegó");
}
const REGISTRO = { sesion_gateway: 456, tiempo_gateway_recepcion_ms: 500, tiempo_torre_ms: 450,
  torre_id: 1, sesion_torre: 10, secuencia_torre_tx: 1, mac_torre: "AA:BB:CC:DD:EE:FF",
  jugador_id: 1, sesion_jugador: 20, secuencia: 1, rssi: -50 };

test("Control de captura: ACK, aislamiento A/B, renovaciones y datos tardíos", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "control-captura-"));
  const gestor = new GestorLecturas({ raiz: resolve(".."), directorioDatos: carpeta, python: "python3",
    host: "127.0.0.1", puertoHttp: await puertoLibre(), puertoUdp: await puertoLibre(), destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" });
  const gateway = new GatewaySimulado(); gateway.confirmar = false;
  await gateway.iniciar(gestor.configuracion.puertoUdp);
  const terminal = (estado: string) => ["error", "completada", "detenida"].includes(estado);
  const capturar = (nombre: string, duracion = 1) => gestor.iniciar({ solicitudId: randomUUID(), nombreArchivo: nombre, duracionSegundos: duracion, directorioSalida: carpeta });
  const post = (id: string) => fetch(`http://127.0.0.1:${gestor.configuracion.puertoHttp}/v1/registros`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Heatmap-Captura": id }, body: JSON.stringify([REGISTRO]),
  });
  try {
    const a = capturar("zona_A");
    await esperar(() => gestor.obtener(a.id), c => !!c.preparado);
    await esperar(() => gateway.puertoHttp, p => p > 0);
    await new Promise(r => setTimeout(r, 1200));
    assert.equal(gestor.obtener(a.id).estado, "iniciando");
    assert.equal(gestor.obtener(a.id).inicioUtc, null);
    assert.equal((await post(a.id)).status, 503);
    const purgas = gateway.purgas;
    assert.equal(gestor.iniciar({ solicitudId: a.solicitudId, nombreArchivo: a.nombreArchivo, duracionSegundos: 1, directorioSalida: carpeta }).id, a.id);
    gateway.confirmar = true;
    const grabando = await esperar(() => gestor.obtener(a.id), c => c.estado === "grabando");
    assert.equal(gateway.purgas, purgas); // Los reintentos no vacían la misma captura.
    assert.equal((await post(a.id)).status, 202);
    const ackA = gateway.ultimoAck;
    await esperar(() => gestor.obtener(a.id), c => terminal(c.estado));
    assert.ok(Date.parse(gestor.obtener(a.id).finUtc!) - Date.parse(grabando.inicioUtc!) >= 1000);
    await esperar(() => gateway.puertoHttp, p => p === 0);
    assert.deepEqual(gateway.cola, []);
    gateway.confirmar = false;
    const b = capturar("zona_B");
    await esperar(() => gestor.obtener(b.id), c => !!c.preparado);
    await esperar(() => gateway.capturaId, id => id === b.id);
    gateway.enviar(ackA);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(gestor.obtener(b.id).estado, "iniciando");
    gateway.confirmar = true;
    await esperar(() => gestor.obtener(b.id), c => c.estado === "grabando");
    assert.equal((await post(a.id)).status, 409);
    assert.equal((await post(randomUUID())).status, 409);
    assert.equal((await post(b.id)).status, 202);
    const resultado = await esperar(() => gestor.obtener(b.id), c => terminal(c.estado));
    assert.equal(resultado.filasEscritas, 1);
    assert.equal(readFileSync(join(carpeta, resultado.archivo), "utf8").trim().split("\n").length, 2);
    assert.equal(gestor.listar().length, 2);
  } finally { await gestor.cerrar(); await gateway.cerrar(); rmSync(carpeta, { recursive: true, force: true }); }
});

test("Sin ACK en 10 s conserva un CSV fallido y desactiva el Gateway", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "control-timeout-"));
  const gestor = new GestorLecturas({ raiz: resolve(".."), directorioDatos: carpeta, python: "python3",
    host: "127.0.0.1", puertoHttp: await puertoLibre(), puertoUdp: await puertoLibre(), destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" });
  const gateway = new GatewaySimulado(); gateway.confirmar = false;
  await gateway.iniciar(gestor.configuracion.puertoUdp);
  try {
    const inicio = Date.now();
    const captura = gestor.iniciar({ solicitudId: randomUUID(), nombreArchivo: "sin_ack", duracionSegundos: 1, directorioSalida: carpeta });
    const resultado = await esperar(() => gestor.obtener(captura.id), c => c.estado === "error", 13000);
    assert.ok(Date.now() - inicio >= 10000);
    assert.match(resultado.error!, /10 segundos/);
    assert.equal(resultado.inicioUtc, null);
    assert.equal(resultado.filasEscritas, 0);
    assert.equal(readFileSync(join(carpeta, resultado.archivo), "utf8").trim().split("\n").length, 1);
    await esperar(() => gateway.puertoHttp, p => p === 0);
    assert.equal(gestor.actual(), null);
    gateway.confirmar = true;
    const reintento = gestor.iniciar({ solicitudId: randomUUID(), nombreArchivo: "reintento", duracionSegundos: 1, directorioSalida: carpeta });
    await esperar(() => gestor.obtener(reintento.id), c => c.estado === "completada");
  } finally { await gestor.cerrar(); await gateway.cerrar(); rmSync(carpeta, { recursive: true, force: true }); }
});

test("Gateway antiguo se rechaza y un reinicio invalida la captura activa", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "control-version-"));
  const gestor = new GestorLecturas({ raiz: resolve(".."), directorioDatos: carpeta, python: "python3",
    host: "127.0.0.1", puertoHttp: await puertoLibre(), puertoUdp: await puertoLibre(), destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" });
  const gateway = new GatewaySimulado(); gateway.controlCaptura = false;
  await gateway.iniciar(gestor.configuracion.puertoUdp);
  const iniciar = () => gestor.iniciar({ solicitudId: randomUUID(), nombreArchivo: "control", duracionSegundos: 20, directorioSalida: carpeta });
  try {
    const viejo = iniciar();
    const error = await esperar(() => gestor.obtener(viejo.id), c => c.estado === "error");
    assert.match(error.error!, /Actualiza el firmware/);
    gateway.controlCaptura = true; gateway.anunciar();
    await esperar(() => gestor.gateway.estado().dispositivos.some(d => d.controlCaptura), Boolean);
    const nuevo = iniciar();
    await esperar(() => gestor.obtener(nuevo.id), c => c.estado === "grabando");
    gateway.sesion += 1; gateway.revision = 0; gateway.puertoHttp = 0; gateway.anunciar();
    const reinicio = await esperar(() => gestor.obtener(nuevo.id), c => c.estado === "error");
    assert.match(reinicio.error!, /reinició/);
  } finally { await gestor.cerrar(); await gateway.cerrar(); rmSync(carpeta, { recursive: true, force: true }); }
});
