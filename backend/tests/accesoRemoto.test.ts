import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { AccesoRemoto } from "../src/accesoRemoto.js";

function peticion(path: string, method = "GET", opciones: { cookie?: string; codigo?: string; origin?: string; local?: boolean; desdePagina?: boolean } = {}) {
  return {
    path, method,
    headers: { host: opciones.local ? "localhost:8000" : "192.168.4.1:8000", origin: opciones.origin, cookie: opciones.cookie, "x-heatmap-login": opciones.desdePagina ? "fetch" : undefined },
    socket: { remoteAddress: opciones.local ? "127.0.0.1" : "192.168.4.2", localAddress: opciones.local ? "127.0.0.1" : "192.168.4.1", localPort: 8000 },
    body: { codigo: opciones.codigo },
  } as unknown as Request;
}

function ejecutar(acceso: AccesoRemoto, req: Request) {
  const respuesta = { codigo: 200, cabeceras: {} as Record<string, string>, siguiente: false, cuerpo: "" };
  const res = {
    setHeader(nombre: string, valor: string) { respuesta.cabeceras[nombre] = valor; return this; },
    status(codigo: number) { respuesta.codigo = codigo; return this; },
    type(_tipo: string) { return this; },
    send(cuerpo: string) { respuesta.cuerpo = cuerpo; return this; },
    json(cuerpo: unknown) { respuesta.cuerpo = JSON.stringify(cuerpo); return this; },
    redirect(codigo: number, destino: string) { respuesta.codigo = codigo; respuesta.cabeceras.Location = destino; return this; },
  } as unknown as Response;
  acceso.middleware()(req, res, () => { respuesta.siguiente = true; });
  return respuesta;
}

test("El código protege panel, APIs y descargas remotas; la administración local permanece libre", () => {
  const acceso = new AccesoRemoto();
  assert.match(acceso.codigo, /^[A-Z2-9]{10}$/);
  assert.equal(ejecutar(acceso, peticion("/api/lecturas")).codigo, 401);
  assert.equal(ejecutar(acceso, peticion("/assets/index.js")).cabeceras.Location, "/acceso");
  assert.match(ejecutar(acceso, peticion("/acceso")).cuerpo, /Código de acceso/);
  assert.equal(ejecutar(acceso, peticion("/api/admin/sesion", "GET", { local: true })).siguiente, true);
  const mala = ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { codigo: "INCORRECTO", origin: "http://192.168.4.1:8000" }));
  assert.equal(mala.codigo, 401);
  const cruzada = ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { codigo: acceso.codigo, origin: "http://sitio-ajeno.test" }));
  assert.equal(cruzada.codigo, 403);
  const buena = ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { codigo: acceso.codigo, origin: "http://192.168.4.1:8000" }));
  assert.equal(buena.codigo, 303);
  const cookie = buena.cabeceras["Set-Cookie"].split(";")[0];
  assert.match(buena.cabeceras["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  assert.equal(ejecutar(acceso, peticion("/api/lecturas", "GET", { cookie })).siguiente, true);
  assert.equal(ejecutar(acceso, peticion("/api/lecturas/id/archivo", "GET", { cookie })).siguiente, true);
  assert.equal(ejecutar(acceso, peticion("/api/lecturas", "POST", { cookie, origin: "http://sitio-ajeno.test" })).codigo, 403);
  assert.equal(ejecutar(acceso, peticion("/api/lecturas", "POST", { cookie, origin: "http://192.168.4.1:8000" })).siguiente, true);
});

test("El emparejamiento limita intentos repetidos", () => {
  const acceso = new AccesoRemoto();
  for (let i = 0; i < 5; i++)
    assert.equal(ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { codigo: "ERRONEO", origin: "http://192.168.4.1:8000" })).codigo, 401);
  assert.equal(ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { codigo: acceso.codigo, origin: "http://192.168.4.1:8000" })).codigo, 429);
});

test("El acceso desde la página devuelve una respuesta para sustituirla en el historial", () => {
  const acceso = new AccesoRemoto();
  const opciones = { origin: "http://192.168.4.1:8000", desdePagina: true };
  const mala = ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { ...opciones, codigo: "INCORRECTO" }));
  assert.equal(mala.codigo, 401);
  assert.deepEqual(JSON.parse(mala.cuerpo), { error: "Código incorrecto." });
  const buena = ejecutar(acceso, peticion("/api/acceso/entrar", "POST", { ...opciones, codigo: acceso.codigo }));
  assert.equal(buena.codigo, 200);
  assert.deepEqual(JSON.parse(buena.cuerpo), { ok: true });
  assert.match(buena.cabeceras["Set-Cookie"], /HttpOnly; SameSite=Strict/);
  assert.match(ejecutar(acceso, peticion("/acceso")).cuerpo, /location\.replace\("\/"\)/);
});
