import { resolve } from "node:path";
import { crearApp } from "../src/app.js";
import { GestorLecturas } from "../src/gestor.js";

// Fixture de integración: se limita a loopback y no cambia el arranque protegido de producción.
const gestor = new GestorLecturas({
  raiz: resolve(".."),
  directorioDatos: process.env.DIRECTORIO_DATOS!,
  python: process.env.PYTHON_EJECUTABLE ?? "python3",
  host: "127.0.0.1",
  puertoHttp: Number(process.env.RECEPTOR_PUERTO_HTTP),
  destinoUdp: "127.0.0.1",
  puertoUdp: Number(process.env.RECEPTOR_PUERTO_UDP),
  zonaHoraria: "America/Costa_Rica",
});
const servidor = crearApp(gestor).listen(Number(process.env.PUERTO_BACKEND), "127.0.0.1");
async function cerrar() { await gestor.cerrar(); servidor.close(); }
process.on("SIGTERM", cerrar);
process.on("SIGINT", cerrar);
