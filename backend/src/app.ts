import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ErrorPeticion, GestorLecturas } from "./gestor.js";

/** Expone el control local de capturas y el frontend compilado desde el mismo origen. */
export function crearApp(gestor: GestorLecturas) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/estado", (_peticion, respuesta) => {
    const actual = gestor.actual();
    respuesta.json({
      actual: actual ? gestor.presentar(actual) : null,
      receptor: {
        host: gestor.configuracion.host,
        puertoHttp: gestor.configuracion.puertoHttp,
        destinoUdp: gestor.configuracion.destinoUdp,
        puertoUdp: gestor.configuracion.puertoUdp,
      },
    });
  });
  app.get("/api/lecturas", (_peticion, respuesta) =>
    respuesta.json(gestor.listar().map((captura) => gestor.presentar(captura))),
  );
  app.get("/api/lecturas/actual", (_peticion, respuesta) => {
    const actual = gestor.actual();
    respuesta.json(actual ? gestor.presentar(actual) : null);
  });
  app.get("/api/lecturas/solicitud/:id", (peticion, respuesta) =>
    respuesta.json(gestor.porSolicitud(peticion.params.id)),
  );
  app.post("/api/lecturas", (peticion, respuesta) =>
    respuesta.status(202).json(gestor.iniciar(peticion.body)),
  );
  app.get("/api/lecturas/:id", (peticion, respuesta) =>
    respuesta.json(gestor.obtener(peticion.params.id)),
  );
  app.post("/api/lecturas/:id/detener", (peticion, respuesta) =>
    respuesta.json(gestor.detener(peticion.params.id)),
  );
  app.get("/api/lecturas/:id/archivo", (peticion, respuesta) => {
    const archivo = gestor.rutaDescarga(peticion.params.id);
    respuesta.download(archivo.ruta, archivo.nombre);
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
