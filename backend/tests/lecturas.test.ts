import { GatewaySimulado } from "./gatewaySimulado.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { crearApp } from "../src/app.js";
import {
  fechaArchivo,
  GestorLecturas,
  validarSolicitud,
} from "../src/gestor.js";
import type { Captura } from "../../shared/lecturas.js";

const REGISTRO = {
  sesion_gateway: 456,
  tiempo_gateway_recepcion_ms: 1234,
  tiempo_torre_ms: 1210,
  torre_id: 1,
  sesion_torre: 321,
  secuencia_torre_tx: 41,
  mac_torre: "AA:BB:CC:DD:EE:FF",
  jugador_id: 1,
  sesion_jugador: 789,
  secuencia: 42,
  rssi: -61,
};
async function puertoLibre() {
  const servidor = createServer();
  await new Promise<void>((resolver) =>
    servidor.listen(0, "127.0.0.1", resolver),
  );
  const puerto = (servidor.address() as { port: number }).port;
  await new Promise<void>((resolver) => servidor.close(() => resolver()));
  return puerto;
}
async function esperar<T>(
  leer: () => Promise<T> | T,
  aceptar: (valor: T) => boolean,
  plazo = 8000,
): Promise<T> {
  const limite = Date.now() + plazo;
  while (Date.now() < limite) {
    const valor = await leer();
    if (aceptar(valor)) return valor;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error("Se agotó el tiempo para esperar el resultado.");
}
const terminal = (captura: Captura) =>
  ["completada", "detenida", "error"].includes(captura.estado);
const solicitud = (nombreArchivo = "prueba", duracionSegundos = 2) => ({
  solicitudId: randomUUID(),
  nombreArchivo,
  duracionSegundos,
});

test("Fecha del archivo y validación de parámetros", () => {
  assert.equal(
    fechaArchivo(new Date("2026-10-04T18:05:00Z"), "America/Costa_Rica"),
    "04_10_26_12_05",
  );
  assert.equal(
    fechaArchivo(new Date("2026-10-04T06:00:00Z"), "America/Costa_Rica"),
    "04_10_26_00_00",
  );
  for (const nombre of [
    "../archivo",
    "C:\\captura",
    "archivo.csv.csv",
    "",
    "CON/archivo",
    "archivo.",
  ])
    assert.throws(() => validarSolicitud(solicitud(nombre)), /nombre/i);
  for (const duracion of [0, -1, 1.5, 86401, NaN])
    assert.throws(
      () => validarSolicitud(solicitud("válido", duracion)),
      /duración/i,
    );
  assert.equal(
    validarSolicitud(solicitud("calibración.csv")).nombreArchivo,
    "calibración",
  );
});

test("API local con el receptor Python real", async (t) => {
  const directorio = mkdtempSync(join(tmpdir(), "esp32-lecturas-"));
  const configuracion = {
    raiz: resolve(".."),
    directorioDatos: directorio,
    python: process.env.PYTHON_EJECUTABLE ?? "python3",
    host: "127.0.0.1",
    puertoHttp: await puertoLibre(),
    destinoUdp: "127.0.0.1",
    puertoUdp: await puertoLibre(),
    zonaHoraria: "America/Costa_Rica",
  };
  const gestor = new GestorLecturas(configuracion);
  const gateway = new GatewaySimulado();
  await gateway.iniciar(configuracion.puertoUdp);
  const servidor = crearApp(gestor).listen(0, "127.0.0.1");
  await new Promise<void>((resolver) => servidor.once("listening", resolver));
  const url = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  async function iniciar(carga: unknown) {
    const respuesta = await fetch(`${url}/api/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(carga),
    });
    return { respuesta, captura: (await respuesta.json()) as Captura };
  }
  async function registros(cuantos = 2) {
    const respuesta = await fetch(
      `http://127.0.0.1:${configuracion.puertoHttp}/v1/registros`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Heatmap-Captura": gestor.actual()!.id },
        body: JSON.stringify(
          Array.from({ length: cuantos }, (_, i) => ({
            ...REGISTRO,
            secuencia: 42 + i,
            secuencia_torre_tx: 41 + i,
          })),
        ),
      },
    );
    assert.equal(respuesta.status, 202);
  }
  t.after(async () => {
    await gestor.cerrar();
    await gateway.cerrar();
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
    rmSync(directorio, { recursive: true, force: true });
  });

  await t.test(
    "Captura por tiempo, idempotencia, exclusión y descarga",
    async () => {
      const carga = solicitud("prueba_zona_1", 2);
      const primera = await iniciar(carga);
      assert.equal(primera.respuesta.status, 202);
      assert.match(
        primera.captura.archivo,
        /^prueba_zona_1_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.csv$/,
      );
      const repetida = await iniciar(carga);
      assert.equal(repetida.captura.id, primera.captura.id);
      assert.equal((await iniciar(solicitud("otra"))).respuesta.status, 409);
      assert.equal(
        (await iniciar({ ...carga, nombreArchivo: "otros_parametros" }))
          .respuesta.status,
        409,
      );
      await esperar(
        () => gestor.obtener(primera.captura.id),
        (captura) => captura.estado === "grabando",
      );
      await registros();
      const resultado = await esperar(
        () => gestor.obtener(primera.captura.id),
        terminal,
      );
      assert.equal(resultado.estado, "completada");
      assert.equal(resultado.filasEscritas, 2);
      assert.ok(resultado.inicioUtc && resultado.finUtc);
      assert.ok(
        Date.parse(resultado.finUtc!) - Date.parse(resultado.inicioUtc!) >=
          2000,
      );
      const csv = readFileSync(join(directorio, resultado.archivo), "utf8");
      assert.equal(csv.trim().split("\n").length, 3);
      assert.match(csv, /sesion_gateway/);
      assert.match(csv, /AA:BB:CC:DD:EE:FF/);
      const descarga = await fetch(
        `${url}/api/lecturas/${resultado.id}/archivo`,
      );
      assert.equal(descarga.status, 200);
      assert.equal(await descarga.text(), csv);
      assert.equal((await iniciar(carga)).captura.id, resultado.id);
    },
  );
  await t.test(
    "Nombres coincidentes no sobrescriben y cero datos deja cabecera",
    async () => {
      const nombre = "colision";
      const reservado = `${nombre}_${fechaArchivo(new Date(), configuracion.zonaHoraria)}.csv`;
      writeFileSync(join(directorio, reservado), "archivo anterior\n");
      const { captura } = await iniciar(solicitud(nombre, 1));
      assert.notEqual(captura.archivo, reservado);
      const resultado = await esperar(
        () => gestor.obtener(captura.id),
        terminal,
      );
      assert.equal(resultado.estado, "completada");
      assert.equal(resultado.filasEscritas, 0);
      assert.equal(
        readFileSync(join(directorio, reservado), "utf8"),
        "archivo anterior\n",
      );
      assert.equal(
        readFileSync(join(directorio, resultado.archivo), "utf8")
          .trim()
          .split("\n").length,
        1,
      );
    },
  );
  await t.test("Detener conserva todos los registros admitidos", async () => {
    const { captura } = await iniciar(solicitud("detenida", 20));
    await esperar(
      () => gestor.obtener(captura.id),
      (captura) => captura.estado === "grabando",
    );
    await registros(8);
    const respuesta = await fetch(`${url}/api/lecturas/${captura.id}/detener`, {
      method: "POST",
    });
    assert.equal(respuesta.status, 200);
    const resultado = await esperar(() => gestor.obtener(captura.id), terminal);
    assert.equal(resultado.estado, "detenida");
    assert.equal(resultado.filasEscritas, 8);
    assert.equal(
      readFileSync(join(directorio, resultado.archivo), "utf8")
        .trim()
        .split("\n").length,
      9,
    );
  });
  await t.test("Puerto ocupado termina con error y sin CSV", async () => {
    const ocupado = createServer();
    await new Promise<void>((resolver) =>
      ocupado.listen(configuracion.puertoHttp, "127.0.0.1", resolver),
    );
    try {
      const { captura } = await iniciar(solicitud("puerto_ocupado", 1));
      const resultado = await esperar(
        () => gestor.obtener(captura.id),
        terminal,
      );
      assert.equal(resultado.estado, "error");
      assert.ok(resultado.error);
      assert.equal(existsSync(join(directorio, resultado.archivo)), false);
    } finally {
      await new Promise<void>((resolver) => ocupado.close(() => resolver()));
    }
  });
  await t.test(
    "Errores de escritura conservan un resultado explícito",
    async () => {
      if (process.platform === "win32") {
        return;
      }
      chmodSync(directorio, 0o555);
      try {
        const { captura } = await iniciar(solicitud("sin_permisos", 1));
        const resultado = await esperar(
          () => gestor.obtener(captura.id),
          terminal,
        );
        assert.equal(resultado.estado, "error");
        assert.match(resultado.error!, /CSV|Permission|permiso/i);
      } finally {
        chmodSync(directorio, 0o755);
      }
    },
  );
  await t.test(
    "Python no disponible se informa sin dejar la captura activa",
    async () => {
      const anterior = gestor.configuracion.python;
      gestor.configuracion.python = join(directorio, "python_inexistente");
      try {
        const { captura } = await iniciar(solicitud("no_python", 1));
        const resultado = await esperar(
          () => gestor.obtener(captura.id),
          terminal,
        );
        assert.equal(resultado.estado, "error");
        assert.match(resultado.error!, /iniciar Python/);
        assert.equal(gestor.actual(), null);
      } finally {
        gestor.configuracion.python = anterior;
      }
    },
  );
});

test("El receptor termina y se recupera después de interrumpir el backend", async (t) => {
  const directorio = mkdtempSync(join(tmpdir(), "esp32-recuperacion-"));
  const puertoApi = await puertoLibre(),
    puertoHttp = await puertoLibre();
  const puertoUdp = await puertoLibre();
  const gateway = new GatewaySimulado();
  await gateway.iniciar(puertoUdp);
  const url = `http://127.0.0.1:${puertoApi}`;
  let backend: ChildProcess | null = null;
  let id: string | null = null;
  let salida = "";
  function levantar() {
    backend = spawn(process.execPath, ["dist/backend/src/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DIRECTORIO_DATOS: directorio,
        PUERTO_BACKEND: String(puertoApi),
        RECEPTOR_HOST: "127.0.0.1",
        RECEPTOR_PUERTO_HTTP: String(puertoHttp),
        RECEPTOR_DESTINO_UDP: "127.0.0.1",
        RECEPTOR_PUERTO_UDP: String(puertoUdp),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stderr?.on("data", (datos) => (salida += datos.toString()));
    backend.stdout?.on("data", () => {});
  }
  async function disponible() {
    await esperar(async () => {
      try {
        return (await fetch(`${url}/api/estado`)).ok;
      } catch {
        return false;
      }
    }, Boolean);
  }
  t.after(async () => {
    if (id) {
      try {
        await fetch(`${url}/api/lecturas/${id}/detener`, { method: "POST" });
      } catch {
        writeFileSync(
          join(directorio, ".lecturas", `${id}.detener`),
          "detener\n",
        );
      }
    }
    if (backend && backend.exitCode === null) {
      backend.kill("SIGTERM");
      await new Promise<void>((resolver) =>
        backend!.once("exit", () => resolver()),
      );
    }
    await gateway.cerrar();
    rmSync(directorio, { recursive: true, force: true });
  });
  levantar();
  await disponible();
  const carga = solicitud("recuperada_zona_2", 4);
  const captura = (await (
    await fetch(`${url}/api/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(carga),
    })
  ).json()) as Captura;
  id = captura.id;
  await esperar(
    async () =>
      (await (await fetch(`${url}/api/lecturas/${id}`)).json()) as Captura,
    (valor) => valor.estado === "grabando",
  );
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${puertoHttp}/v1/registros`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Heatmap-Captura": id! },
        body: JSON.stringify([REGISTRO]),
      })
    ).status,
    202,
  );
  const revisionAntes = gateway.revision;
  backend!.kill("SIGKILL");
  await new Promise<void>((resolver) =>
    backend!.once("exit", () => resolver()),
  );
  // El navegador tampoco envía otra instrucción mientras el backend está detenido.
  levantar();
  await disponible();
  assert.equal(gateway.revision, revisionAntes);
  const resultado = await esperar(
    async () =>
      (await (await fetch(`${url}/api/lecturas/${id}`)).json()) as Captura,
    terminal,
  );
  assert.equal(resultado.estado, "completada", salida);
  assert.equal(resultado.filasEscritas, 1);
  assert.equal(
    readFileSync(join(directorio, resultado.archivo), "utf8").trim().split("\n")
      .length,
    2,
  );
  const duplicada = (await (
    await fetch(`${url}/api/lecturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(carga),
    })
  ).json()) as Captura;
  assert.equal(duplicada.id, id);
  assert.equal(
    ((await (await fetch(`${url}/api/lecturas`)).json()) as Captura[]).length,
    1,
  );
});
