import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crearApp } from "./app.js";
import { GestorLecturas } from "./gestor.js";

/** Encuentra el repositorio tanto al ejecutar TypeScript como el backend compilado. */
function encontrarRaiz() {
  let carpeta = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(carpeta, "python/receptor_gateway.py"))) {
    const superior = dirname(carpeta);
    if (superior === carpeta)
      throw new Error("No se encontró el receptor Python del proyecto.");
    carpeta = superior;
  }
  return carpeta;
}
function puerto(variable: string, defecto: number) {
  const valor = Number(process.env[variable] ?? defecto);
  if (!Number.isInteger(valor) || valor < 1 || valor > 65535)
    throw new Error(`${variable} debe ser un puerto válido.`);
  return valor;
}
const raiz = encontrarRaiz();
const entornoPython = resolve(
  raiz,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const gestor = new GestorLecturas({
  raiz,
  directorioDatos: process.env.DIRECTORIO_DATOS ?? resolve(raiz, "data/raw"),
  python:
    process.env.PYTHON_EJECUTABLE ??
    (existsSync(entornoPython)
      ? entornoPython
      : process.platform === "win32"
        ? "python"
        : "python3"),
  host: process.env.RECEPTOR_HOST ?? "0.0.0.0",
  puertoHttp: puerto("RECEPTOR_PUERTO_HTTP", 8080),
  destinoUdp: process.env.RECEPTOR_DESTINO_UDP ?? "192.168.4.255",
  puertoUdp: puerto("RECEPTOR_PUERTO_UDP", 4210),
  zonaHoraria: process.env.ZONA_HORARIA ?? "America/Costa_Rica",
});
const gateway = gestor.gateway;
const hostBackend = process.env.HOST_BACKEND ?? "0.0.0.0";
const puertoBackend = puerto("PUERTO_BACKEND", 8000);
const servidor = crearApp(gestor, gateway).listen(
  puertoBackend,
  hostBackend,
  () => {
    gateway.iniciar();
    if (hostBackend === "0.0.0.0" || hostBackend === "127.0.0.1")
      console.log(`Panel local disponible en http://localhost:${puertoBackend}`);
    for (const [interfaz, direcciones] of Object.entries(networkInterfaces())) {
      for (const direccion of direcciones ?? []) {
        if (direccion.family === "IPv4" && !direccion.internal &&
            (hostBackend === "0.0.0.0" || hostBackend === direccion.address))
          console.log(`Acceso desde la red (${interfaz}): http://${direccion.address}:${puertoBackend}`);
      }
    }
  },
);
servidor.on("error", async (error) => {
  console.error(`No se pudo iniciar el backend: ${error.message}`);
  await gestor.cerrar();
  process.exitCode = 1;
});
let cerrando = false;
async function cerrar() {
  if (cerrando) return;
  cerrando = true;
  await gestor.cerrar();
  servidor.close(() => {
    process.exitCode = 0;
  });
}
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
