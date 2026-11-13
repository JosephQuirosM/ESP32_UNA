import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RaicesAutorizadas } from "../src/raicesAutorizadas.js";
import { GestorLecturas } from "../src/gestor.js";
import { crearApp } from "../src/app.js";

test("Sólo se permiten rutas reales dentro de raíces aprobadas, incluso tras reinicio", () => {
  const base = mkdtempSync(join(tmpdir(), "esp32-raices-"));
  const datos = join(base, "datos"), fuera = join(base, "datos-ajenos");
  mkdirSync(datos); mkdirSync(fuera);
  const csv = join(datos, "lecturas.csv"), secreto = join(fuera, "secreto.csv");
  writeFileSync(csv, "rssi\n-60\n"); writeFileSync(secreto, "privado\n");
  symlinkSync(secreto, join(datos, "enlace.csv"));
  try {
    const seguridad = new RaicesAutorizadas(base);
    assert.throws(() => seguridad.permitir(csv), /autorizad/);
    const raiz = seguridad.agregar(datos);
    assert.equal(seguridad.permitir(csv, "archivo"), csv);
    assert.throws(() => seguridad.permitir(secreto, "archivo"), /fuera/);
    assert.throws(() => seguridad.permitir(join(datos, "enlace.csv"), "archivo"), /fuera/);
    assert.throws(() => seguridad.permitir(join(datos, "..", "datos-ajenos", "secreto.csv")), /fuera/);
    assert.deepEqual(seguridad.explorar(raiz.id).elementos.map(e => e.nombre), ["lecturas.csv"]);
    const nueva = seguridad.crearCarpeta(raiz.id, "", "capturas");
    assert.equal(nueva.ruta, join(datos, "capturas"));
    assert.deepEqual(seguridad.explorar(raiz.id).elementos.map(e => e.nombre), ["capturas", "lecturas.csv"]);
    assert.throws(() => seguridad.crearCarpeta(raiz.id, "", "../escape"), /nombre/);
    assert.throws(() => seguridad.crearCarpeta(raiz.id, "", ".oculta"), /nombre/);
    assert.throws(() => seguridad.crearCarpeta(raiz.id, "", "capturas"), /existe/);
    assert.throws(() => seguridad.crearCarpeta(raiz.id, "../datos-ajenos", "escape"), /fuera/);
    symlinkSync(fuera, join(datos, "enlace-carpeta"));
    assert.throws(() => seguridad.crearCarpeta(raiz.id, "enlace-carpeta", "escape"), /fuera/);
    assert.equal(new RaicesAutorizadas(base).permitir(csv), csv);
    seguridad.quitar(raiz.id);
    assert.throws(() => seguridad.permitir(csv), /autorizad/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("La administración de raíces exige sesión local y el explorador no sale del perímetro", async () => {
  const base = mkdtempSync(join(tmpdir(), "esp32-admin-"));
  const autorizada = join(base, "permitida"), fuera = join(base, "fuera");
  mkdirSync(autorizada); mkdirSync(fuera);
  writeFileSync(join(autorizada, "lecturas.csv"), "rssi\n-50\n");
  writeFileSync(join(fuera, "externo.csv"), "rssi\n-40\n");
  writeFileSync(join(fuera, "externo.joblib"), "modelo\n");
  const gestor = new GestorLecturas({ raiz: base, directorioDatos: join(base, "estado"), python: "python3", host: "127.0.0.1", puertoHttp: 8080, puertoUdp: 0, destinoUdp: "127.0.0.1", zonaHoraria: "America/Costa_Rica" });
  const seguridad = new RaicesAutorizadas(gestor.configuracion.directorioDatos);
  const server = crearApp(gestor, gestor.gateway, seguridad).listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const sesion = await (await fetch(`${url}/api/admin/sesion`)).json() as { token: string };
    const sinToken = await fetch(`${url}/api/admin/raices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruta: autorizada }) });
    assert.equal(sinToken.status, 403);
    const creada = await fetch(`${url}/api/admin/raices`, { method: "POST", headers: { "Content-Type": "application/json", "X-Heatmap-Admin": sesion.token }, body: JSON.stringify({ ruta: autorizada }) });
    assert.equal(creada.status, 201);
    const raiz = await creada.json() as { id: string };
    const listado = await (await fetch(`${url}/api/archivos?raiz=${raiz.id}`)).json() as { elementos: { nombre: string }[] };
    assert.deepEqual(listado.elementos.map(e => e.nombre), ["lecturas.csv"]);
    const creadaCarpeta = await fetch(`${url}/api/archivos/carpetas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raiz: raiz.id, ruta: "", nombre: "resultados" }) });
    assert.equal(creadaCarpeta.status, 201);
    assert.equal((await creadaCarpeta.json() as { ruta: string }).ruta, join(autorizada, "resultados"));
    assert.equal((await fetch(`${url}/api/archivos/descargar?ruta=${encodeURIComponent(join(autorizada, "lecturas.csv"))}`)).status, 200);
    assert.equal((await fetch(`${url}/api/archivos/descargar?ruta=${encodeURIComponent(join(fuera, "externo.csv"))}`)).status, 403);
    assert.equal((await fetch(`${url}/api/archivos/carpetas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raiz: raiz.id, ruta: "../fuera", nombre: "escape" }) })).status, 403);
    assert.equal((await fetch(`${url}/api/archivos?raiz=${raiz.id}&ruta=..%2Ffuera`)).status, 403);
    const casos = [
      ["/api/entrenamiento/inspeccionar", { entrada: join(fuera, "externo.csv") }],
      ["/api/lecturas", { solicitudId: "solicitud-externa", nombreArchivo: "externo", duracionSegundos: 1, directorioSalida: fuera }],
      ["/api/preparacion", { archivos: [{ nombre: "zona.csv", zona: 1, contenido: "rssi\n-40\n" }], directorioSalida: fuera }],
      ["/api/mapas", { entradas: [join(autorizada, "lecturas.csv")], modelo: join(fuera, "externo.joblib"), nombre: "prueba", ventana: 1, directorioSalida: autorizada }],
    ] as const;
    for (const [ruta, carga] of casos) {
      const estado = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(url + ruta, { method: "POST",
          headers: { Host: "192.168.4.1:8000", "Content-Type": "application/json" } }, res => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end(JSON.stringify(carga));
      });
      assert.equal(estado, 403, ruta);
    }
    assert.equal((await fetch(`${url}/api/admin/raices/${raiz.id}`, { method: "DELETE", headers: { "X-Heatmap-Admin": sesion.token } })).status, 204);
    assert.equal((await fetch(`${url}/api/archivos?raiz=${raiz.id}`)).status, 404);
    assert.equal((await fetch(`${url}/api/archivos/descargar?ruta=${encodeURIComponent(join(autorizada, "lecturas.csv"))}`)).status, 403);
  } finally {
    await gestor.cerrar();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});
