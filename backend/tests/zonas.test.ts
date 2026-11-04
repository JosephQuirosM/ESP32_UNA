import { GatewaySimulado } from "./gatewaySimulado.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, symlinkSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { crearApp } from "../src/app.js";
import { GestorLecturas } from "../src/gestor.js";
import { generarZonas, validarCuadricula } from "../../shared/cuadricula.js";

const repo = existsSync(resolve("python")) ? resolve(".") : resolve("..");
const python = join(repo, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
async function puertoLibre() {
  const servidor = createServer().listen(0, "127.0.0.1");
  await new Promise<void>(r => servidor.on("listening", r));
  const puerto = (servidor.address() as { port: number }).port;
  await new Promise<void>(r => servidor.close(() => r()));
  return puerto;
}

test("Geometría compartida: dimensiones y zonas completas sin límite fijo de nueve", () => {
  for (const [filas, columnas] of [[1, 1], [2, 2], [3, 4], [4, 3], [20, 20]]) {
    const zonas = generarZonas(filas, columnas);
    assert.equal(validarCuadricula({ filas, columnas, zonas }).zonas.length, filas * columnas);
  }
  assert.throws(() => validarCuadricula({ filas: 3, columnas: 4, zonas: Array(12).fill(1) }));
  assert.throws(() => validarCuadricula({ filas: 0, columnas: 4, zonas: [] }));
});

test("HTTP: captura guiada de 12 zonas conserva acomodo hasta el mapa KNN y RF", { skip: !existsSync(python) }, async () => {
  const raiz = mkdtempSync(join(tmpdir(), "zonas-dinamicas-"));
  symlinkSync(join(repo, "python"), join(raiz, "python"), "dir");
  const puertoHttp = await puertoLibre();
  const gestor = new GestorLecturas({ raiz, directorioDatos: join(raiz, "data/raw"), python,
    host: "127.0.0.1", puertoHttp, puertoUdp: await puertoLibre(), destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" });
  const gateway = new GatewaySimulado(); gateway.sesion = 1;
  await gateway.iniciar(gestor.configuracion.puertoUdp);
  const app = crearApp(gestor);
  const servidor = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => servidor.on("listening", r));
  const url = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  const post = (ruta: string, carga: unknown) => fetch(url + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(carga) });
  async function esperar(ruta: string, predicado: (estado: any) => boolean) {
    const limite = Date.now() + 30000;
    let estado: any;
    do {
      const res = await fetch(url + ruta); assert.equal(res.status, 200);
      estado = await res.json();
      if (predicado(estado)) return estado;
      await new Promise(r => setTimeout(r, 50));
    } while (Date.now() < limite);
    assert.fail(`No terminó: ${JSON.stringify(estado)}`);
  }
  try {
    const cuadricula = { filas: 3, columnas: 4, zonas: generarZonas(3, 4) };
    [cuadricula.zonas[0], cuadricula.zonas[11]] = [cuadricula.zonas[11], cuadricula.zonas[0]];
    const solicitud = { solicitudId: "captura-zonas-12", nombreArchivo: "zona_12", duracionSegundos: 2, cuadricula };
    assert.equal((await post("/api/lecturas", { ...solicitud, cuadricula: { ...cuadricula, zonas: [1] } })).status, 400);
    const inicio = await post("/api/lecturas", solicitud); assert.equal(inicio.status, 202);
    const captura = await inicio.json() as { id: string };
    await esperar(`/api/lecturas/${captura.id}`, c => c.estado === "grabando");
    assert.equal((await post("/api/lecturas", { ...solicitud, cuadricula: { filas: 4, columnas: 3, zonas: generarZonas(4, 3) } })).status, 409);
    const macs = ["10:06:1C:D5:95:04", "90:15:06:5A:30:D0", "10:06:1C:D5:95:8C", "10:06:1C:D4:8F:C4"];
    const lote = macs.map((mac_torre, i) => ({ sesion_gateway: 1, tiempo_gateway_recepcion_ms: 500,
      tiempo_torre_ms: 500, torre_id: i + 1, sesion_torre: 10 + i, secuencia_torre_tx: 1,
      mac_torre, jugador_id: 1, sesion_jugador: 1, secuencia: 1, rssi: -70 - i }));
    assert.equal((await fetch(`http://127.0.0.1:${puertoHttp}/v1/registros`, { method: "POST", headers: { "Content-Type": "application/json", "X-Heatmap-Captura": captura.id }, body: JSON.stringify(lote) })).status, 202);
    await esperar(`/api/lecturas/${captura.id}`, c => c.estado === "completada");
    const crudo = await (await fetch(`${url}/api/lecturas/${captura.id}/archivo`)).text();
    assert.ok(crudo.split("\n")[0].includes("cuadricula"));
    const preparacion = await post("/api/preparacion", { archivos: [{ nombre: "zona_12.csv", zona: 12, contenido: crudo }] });
    assert.equal(preparacion.status, 201);
    const preparado = await preparacion.json() as { rutaSalida: string; cuadricula: unknown };
    assert.deepEqual(preparado.cuadricula, cuadricula);
    for (const algoritmo of ["knn", "random_forest"]) {
      const parametros = algoritmo === "knn" ? { k: 1, pesos: "distance", distancia: "euclidean", normalizar: true }
        : { arboles: 8, profundidad: null, min_division: 2, min_hoja: 1, semilla: 42 };
      const inicioModelo = await post("/api/entrenamiento", { entrada: preparado.rutaSalida, algoritmo, nombre: algoritmo, directorioSalida: raiz, parametros });
      assert.equal(inicioModelo.status, 202);
      const { id } = await inicioModelo.json() as { id: string };
      const modelo = await esperar(`/api/entrenamiento/${id}`, t => ["completado", "error"].includes(t.estado));
      assert.equal(modelo.estado, "completado", JSON.stringify(modelo));
      assert.deepEqual(modelo.cuadricula, cuadricula);
      assert.deepEqual(JSON.parse(readFileSync(modelo.rutaResumen, "utf8")).cuadricula, cuadricula);
      const inicioMapa = await post("/api/mapas", { entradas: [preparado.rutaSalida], modelo: modelo.rutaModelo, nombre: algoritmo, ventana: 1, directorioSalida: raiz });
      assert.equal(inicioMapa.status, 202);
      const mapaId = (await inicioMapa.json() as { id: string }).id;
      const mapa = await esperar(`/api/mapas/${mapaId}`, t => ["completado", "error"].includes(t.estado));
      assert.equal(mapa.estado, "completado", JSON.stringify(mapa));
      assert.deepEqual(mapa.mapas[0].cuadricula, cuadricula);
      assert.equal(mapa.mapas[0].conteos["12"], 1);
      assert.equal(Object.keys(mapa.mapas[0].conteos).length, 12);
      const imagen = await fetch(`${url}${mapa.mapas[0].imagen}`);
      assert.equal(imagen.status, 200); assert.match(imagen.headers.get("content-type") ?? "", /image\/png/);
    }
    assert.equal((await post("/api/mapas", { cuadricula: { filas: 21, columnas: 1, zonas: [] } })).status, 400);
  } finally {
    await gestor.cerrar(); await gateway.cerrar(); await new Promise<void>(r => servidor.close(() => r()));
    rmSync(raiz, { recursive: true, force: true });
  }
});
