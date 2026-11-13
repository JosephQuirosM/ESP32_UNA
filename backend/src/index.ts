import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crearApp } from "./app.js";
import { GestorLecturas } from "./gestor.js";
import { RaicesAutorizadas } from "./raicesAutorizadas.js";
import { AccesoRemoto } from "./accesoRemoto.js";

function encontrarRaiz() {
  let carpeta = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(carpeta, "python/receptor_gateway.py"))) {
    const superior = dirname(carpeta);
    if (superior === carpeta) throw new Error("No se encontró el receptor Python del proyecto.");
    carpeta = superior;
  }
  return carpeta;
}
function puerto(variable: string, defecto: number) {
  const valor = Number(process.env[variable] ?? defecto);
  if (!Number.isInteger(valor) || valor < 1 || valor > 65535) throw new Error(`${variable} debe ser un puerto válido.`);
  return valor;
}

const raiz = encontrarRaiz();
const entornoPython = resolve(raiz, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const puertoBackend = puerto("PUERTO_BACKEND", 8000);
const puertoHttp = puerto("RECEPTOR_PUERTO_HTTP", 8080);
const puertoUdp = puerto("RECEPTOR_PUERTO_UDP", 4210);
const gestor = new GestorLecturas({
  raiz,
  directorioDatos: process.env.DIRECTORIO_DATOS ?? resolve(raiz, "data/raw"),
  python: process.env.PYTHON_EJECUTABLE ?? (existsSync(entornoPython) ? entornoPython : process.platform === "win32" ? "python" : "python3"),
  host: "0.0.0.0",
  puertoHttp,
  destinoUdp: process.env.RECEPTOR_DESTINO_UDP ?? "192.168.4.255",
  puertoUdp,
  zonaHoraria: process.env.ZONA_HORARIA ?? "America/Costa_Rica",
});
const seguridad = new RaicesAutorizadas(gestor.configuracion.directorioDatos);
const acceso = new AccesoRemoto();
const app = crearApp(gestor, gestor.gateway, seguridad, acceso);
let ipsPublicadas = new Set<string>();
let panelListo = false;
const panel = app.listen(puertoBackend, "0.0.0.0", () => {
  panelListo = true;
  console.log(`Panel de esta PC: http://localhost:${puertoBackend}`);
  console.log(`Código para otros dispositivos: ${acceso.codigo}`);
  publicarEnlaces();
});
panel.on("error", (error) => {
  console.error(`No se pudo abrir el panel: ${error.message}`);
  process.exitCode = 1;
  void cerrar();
});
let cerrando = false;

function publicarEnlaces() {
  if (!panelListo) return;
  const actuales = new Set<string>();
  for (const [interfaz, direcciones] of Object.entries(networkInterfaces())) {
    for (const direccion of direcciones ?? []) {
      if (direccion.family !== "IPv4" || direccion.internal || actuales.has(direccion.address)) continue;
      actuales.add(direccion.address);
      if (!ipsPublicadas.has(direccion.address))
        console.log(`Panel en red (${interfaz}): http://${direccion.address}:${puertoBackend}`);
    }
  }
  ipsPublicadas = actuales;
}
const vigilanciaRed = setInterval(publicarEnlaces, 3000);

async function cerrar() {
  if (cerrando) return;
  cerrando = true; clearInterval(vigilanciaRed);
  panel.close();
  panel.closeAllConnections();
  await gestor.cerrar();
}
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
