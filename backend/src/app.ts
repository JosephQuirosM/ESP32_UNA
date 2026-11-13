import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { rutasMapas } from "./mapas.js";
import { rutasEntrenamiento } from "./entrenamiento.js";
import { rutasPreparacion } from "./preparacion.js";
import { rutasJugadores } from "./jugadores.js";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { ErrorPeticion, GestorLecturas } from "./gestor.js";
import type { DescubridorGateway } from "./gateway.js";
import { leerRutasPreferidas } from "./rutasPreferidas.js";
import type { RaicesAutorizadas } from "./raicesAutorizadas.js";
import { seleccionarCarpeta } from "./selectorCarpeta.js";
import { puedeUsarRutasLocales, restriccionesDeRutas } from "./accesoLocal.js";
import { AccesoRemoto } from "./accesoRemoto.js";

/** Expone el control local de capturas y el frontend compilado desde el mismo origen. */
export function crearApp(gestor: GestorLecturas, gateway: DescubridorGateway = gestor.gateway, seguridad?: RaicesAutorizadas, acceso?: AccesoRemoto) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "1kb" }));
  if (acceso) app.use(acceso.middleware());
  const tokenAdmin = randomBytes(32).toString("hex");
  function exigirAdmin(req: express.Request) {
    if (!puedeUsarRutasLocales(req)) throw new ErrorPeticion(403, "Abre el panel con localhost en esta PC.");
    if (req.method !== "GET") {
      const recibido = req.header("X-Heatmap-Admin") ?? "";
      const a = Buffer.from(recibido), b = Buffer.from(tokenAdmin);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ErrorPeticion(403, "Sesión de administración inválida.");
    }
  }
  app.get("/api/admin/sesion", (req, res) => { exigirAdmin(req); res.setHeader("Cache-Control", "no-store").json({ token: tokenAdmin, codigoAcceso: acceso?.codigo ?? null, raices: seguridad?.listar() ?? [] }); });
  app.post("/api/admin/seleccionar-carpeta", async (req, res) => { exigirAdmin(req); res.json({ ruta: await seleccionarCarpeta(gestor.configuracion.raiz) }); });
  app.post("/api/admin/raices", express.json({ limit: "2kb" }), (req, res) => {
    exigirAdmin(req);
    if (!seguridad) throw new ErrorPeticion(503, "La protección de carpetas no está activa.");
    res.status(201).json(seguridad.agregar(req.body?.ruta));
  });
  app.delete("/api/admin/raices/:id", (req, res) => {
    exigirAdmin(req);
    if (!seguridad) throw new ErrorPeticion(503, "La protección de carpetas no está activa.");
    seguridad.quitar(req.params.id);
    gestor.revocarCapturaFueraDeRaices(seguridad);
    res.status(204).end();
  });
  app.get("/api/archivos/raices", (_req, res) => res.json(seguridad?.listar() ?? []));
  app.get("/api/archivos", (req, res) => {
    if (!seguridad) throw new ErrorPeticion(503, "La protección de carpetas no está activa.");
    res.json(seguridad.explorar(String(req.query.raiz ?? ""), req.query.ruta ?? ""));
  });
  app.post("/api/archivos/carpetas", express.json({ limit: "2kb" }), (req, res) => {
    if (!seguridad) throw new ErrorPeticion(503, "La protección de carpetas no está activa.");
    res.status(201).json(seguridad.crearCarpeta(req.body?.raiz, req.body?.ruta ?? "", req.body?.nombre));
  });
  app.get("/api/archivos/descargar", (req, res) => {
    if (!seguridad) throw new ErrorPeticion(503, "La protección de carpetas no está activa.");
    const ruta = seguridad.permitir(req.query.ruta, "archivo");
    res.download(ruta, basename(ruta));
  });
  app.use("/api/mapas", rutasMapas(gestor.configuracion, seguridad));
  app.use("/api/entrenamiento", rutasEntrenamiento(gestor.configuracion, seguridad));
  app.use("/api/preparacion/jugadores", rutasJugadores(gestor.configuracion, seguridad));
  app.use("/api/preparacion", rutasPreparacion(gestor.configuracion, seguridad));
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/rutas-preferidas", (peticion, respuesta) => {
    const preferencias = leerRutasPreferidas(gestor.configuracion.directorioDatos);
    const selectorLocal = puedeUsarRutasLocales(peticion);
    respuesta.setHeader("Cache-Control", "no-store");
    const restricciones = restriccionesDeRutas(peticion, seguridad);
    const visibles = restricciones ? Object.fromEntries(Object.entries(preferencias).flatMap<[string, string | string[]]>(([clave, valor]) => {
      try {
        if (Array.isArray(valor)) return valor.every(r => restricciones.permitir(r, "archivo")) ? [[clave, valor]] : [];
        return [[clave, restricciones.permitir(valor)]];
      } catch { return []; }
    })) : preferencias;
    respuesta.json({ ...visibles, selectorLocal });
  });
  const visible = (peticion: express.Request, captura: { directorioSalida?: string }) => {
    try { restriccionesDeRutas(peticion, seguridad)?.permitir(captura.directorioSalida ?? gestor.configuracion.directorioDatos, "carpeta"); return true; }
    catch { return false; }
  };
  app.get("/api/estado", (peticion, respuesta) => {
    const actual = gestor.actual();
    respuesta.json({
      actual: actual && visible(peticion, actual) ? gestor.presentar(actual) : null,
      gateway: gateway?.estado() ?? { escuchando: false, error: null, dispositivos: [] },
      receptor: {
        host: gestor.configuracion.host,
        puertoHttp: gestor.configuracion.puertoHttp,
        destinoUdp: gestor.configuracion.destinoUdp,
        puertoUdp: gestor.configuracion.puertoUdp,
      },
    });
  });
  app.get("/api/gateway", (_peticion, respuesta) =>
    respuesta.json(gateway?.estado() ?? { escuchando: false, error: null, dispositivos: [] }),
  );
  app.get("/api/lecturas", (peticion, respuesta) =>
    respuesta.json(gestor.listar().filter(captura => visible(peticion, captura)).map((captura) => gestor.presentar(captura))),
  );
  app.get("/api/lecturas/actual", (peticion, respuesta) => {
    const actual = gestor.actual();
    respuesta.json(actual && visible(peticion, actual) ? gestor.presentar(actual) : null);
  });
  app.get("/api/lecturas/solicitud/:id", (peticion, respuesta) => { const captura = gestor.porSolicitud(peticion.params.id); if (!visible(peticion, captura)) throw new ErrorPeticion(403, "Captura fuera de las carpetas autorizadas."); respuesta.json(captura); });
  app.post("/api/lecturas", (peticion, respuesta) =>
    respuesta.status(202).json(gestor.iniciar(peticion.body, restriccionesDeRutas(peticion, seguridad))),
  );
  app.get("/api/lecturas/:id", (peticion, respuesta) => { const captura = gestor.obtener(peticion.params.id); if (!visible(peticion, captura)) throw new ErrorPeticion(403, "Captura fuera de las carpetas autorizadas."); respuesta.json(captura); });
  app.post("/api/lecturas/:id/detener", (peticion, respuesta) => { const captura = gestor.obtener(peticion.params.id); if (!visible(peticion, captura)) throw new ErrorPeticion(403, "Captura fuera de las carpetas autorizadas."); respuesta.json(gestor.detener(peticion.params.id)); });
  app.get("/api/lecturas/:id/archivo", (peticion, respuesta) => {
    const archivo = gestor.rutaDescarga(peticion.params.id);
    const ruta = restriccionesDeRutas(peticion, seguridad)?.permitir(archivo.ruta, "archivo") ?? archivo.ruta;
    respuesta.download(ruta, archivo.nombre);
  });
  app.use("/api", (_peticion, respuesta) =>
    respuesta.status(404).json({ error: "Operación no encontrada." }),
  );
  const frontend = join(gestor.configuracion.raiz, "frontend/dist");
  if (existsSync(join(frontend, "index.html")))
    app.use(express.static(frontend));
  app.use(
    (
      error: Error & { status?: number },
      _peticion: express.Request,
      respuesta: express.Response,
      _siguiente: express.NextFunction,
    ) => {
      respuesta
        .status(
          error instanceof ErrorPeticion
            ? error.estadoHttp
            : (error.status ?? 500),
        )
        .json({ error: error.message || "No se pudo completar la operación." });
    },
  );
  return app;
}
