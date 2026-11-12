import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crearApp } from "./app.js";
import { GestorLecturas } from "./gestor.js";
import { RaicesAutorizadas } from "./raicesAutorizadas.js";
import { AccesoRemoto } from "./accesoRemoto.js";
import { detectarHotspot } from "./detectarHotspot.js";

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
  host: "127.0.0.1",
  puertoHttp,
  destinoUdp: process.env.RECEPTOR_DESTINO_UDP ?? "192.168.4.255",
  puertoUdp,
  zonaHoraria: process.env.ZONA_HORARIA ?? "America/Costa_Rica",
}, false);
gestor.redLista = false;
const seguridad = new RaicesAutorizadas(gestor.configuracion.directorioDatos);
gestor.seguridad = seguridad;
const acceso = new AccesoRemoto();
const app = crearApp(gestor, gestor.gateway, seguridad, acceso);
const local = app.listen(puertoBackend, "127.0.0.1", () => console.log(`Panel de esta PC: http://localhost:${puertoBackend}`));
console.log(`Código para dispositivos del hotspot: ${acceso.codigo}`);
local.on("error", (error) => { console.error(`No se pudo abrir el panel local: ${error.message}`); process.exitCode = 1; });
let publico: ReturnType<typeof app.listen> | null = null;
let ipPublica: string | null = null;
let cerrando = false;
let sincronizando = false;

function cerrarPublico() {
  const anterior = publico; publico = null; ipPublica = null;
  if (anterior) { anterior.closeAllConnections(); anterior.close(); }
}
function desconectar(motivo: string) {
  gestor.redLista = false;
  gestor.estadoRed = motivo;
  cerrarPublico();
  // Se suspende la comunicación, conservando el proceso Python, UUID y CSV.
  // El receptor cierra su listener por su propia vigilancia y lo reabre cuando
  // se detecte otra vez el hotspot. La autorización se renueva al reconectar.
  gestor.gateway.cerrar();
  gestor.configuracion.host = "127.0.0.1";
}
async function comprobarRed() {
  if (cerrando || sincronizando) return;
  sincronizando = true;
  try {
    const estado = await detectarHotspot(gestor.configuracion.python, raiz);
    if (cerrando) return;
    if (!estado) {
      if (publico || gestor.redLista || gestor.actual()) desconectar("No se detecta el hotspot. La captura abierta espera la reconexión; acceso sólo en esta PC.");
      else gestor.estadoRed = "No se detecta el hotspot. Acceso disponible sólo en esta PC.";
      return;
    }
    if (publico && ipPublica === estado.ip) { gestor.estadoRed = `Hotspot: ${estado.ip}; acceso con código`; return; }
    if (publico) desconectar("Cambió la dirección del hotspot; reabriendo el panel.");
    gestor.configuracion.host = estado.ip;
    const servidor = app.listen(puertoBackend, estado.ip);
    servidor.once("listening", () => {
      if (cerrando || publico !== servidor) { servidor.close(); return; }
      ipPublica = estado.ip;
      gestor.redLista = true;
      gestor.estadoRed = `Hotspot: ${estado.ip}; acceso con código`;
      gestor.gateway.iniciar();
      console.log(`Panel en el hotspot: http://${estado.ip}:${puertoBackend}`);
    });
    servidor.on("error", (error) => { console.error(`No se pudo abrir el panel del hotspot: ${error.message}`); if (publico === servidor) desconectar("No se pudo abrir el panel en el hotspot."); });
    publico = servidor;
  } catch (error) {
    desconectar(`No se pudo comprobar el hotspot: ${(error as Error).message}`);
  } finally { sincronizando = false; }
}
void comprobarRed();
const vigilanciaRed = setInterval(() => void comprobarRed(), 3000);

async function cerrar() {
  if (cerrando) return;
  cerrando = true; clearInterval(vigilanciaRed);
  cerrarPublico();
  await gestor.cerrar();
  local.close(() => { process.exitCode = 0; });
}
process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
