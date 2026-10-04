import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  capturaActiva,
  type Captura,
  type SolicitudLectura,
} from "../../shared/lecturas.js";

export class ErrorPeticion extends Error {
  constructor(
    public estadoHttp: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}
export interface Configuracion {
  raiz: string;
  directorioDatos: string;
  python: string;
  host: string;
  puertoHttp: number;
  destinoUdp: string;
  puertoUdp: number;
  zonaHoraria: string;
}
interface EventoPython {
  estado: Captura["estado"];
  inicioUtc?: string;
  finPrevistoUtc?: string;
  finUtc?: string;
  filasEscritas?: number;
  ultimaRecepcionUtc?: string | null;
  error?: string | null;
  pid?: number;
}

/** Construye la fecha del archivo con la zona horaria del PC de captura. */
export function fechaArchivo(fecha: Date, zonaHoraria: string): string {
  const partes = new Intl.DateTimeFormat("es-CR", {
    timeZone: zonaHoraria,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo: string) =>
    partes.find((parte) => parte.type === tipo)!.value;
  return ["day", "month", "year", "hour", "minute"].map(valor).join("_");
}

/** Valida parámetros del navegador antes de ejecutar un proceso. */
export function validarSolicitud(carga: unknown): SolicitudLectura {
  if (!carga || typeof carga !== "object")
    throw new ErrorPeticion(400, "Se espera un formulario válido.");
  const { solicitudId, nombreArchivo, duracionSegundos } =
    carga as Partial<SolicitudLectura>;
  if (typeof solicitudId !== "string" || !/^[\w-]{8,100}$/.test(solicitudId))
    throw new ErrorPeticion(400, "Identificador de solicitud inválido.");
  if (typeof nombreArchivo !== "string")
    throw new ErrorPeticion(400, "Escribe el nombre del archivo.");
  const nombre = nombreArchivo.trim().replace(/\.csv$/i, "");
  if (
    !nombre ||
    nombre.length > 100 ||
    !/^[\p{L}\p{N}_ -]+$/u.test(nombre) ||
    /[ .]$/.test(nombre)
  )
    throw new ErrorPeticion(
      400,
      "El nombre debe contener letras, números, espacios o guiones, sin rutas ni puntos.",
    );
  if (
    typeof duracionSegundos !== "number" ||
    !Number.isInteger(duracionSegundos) ||
    duracionSegundos < 1 ||
    duracionSegundos > 86400
  )
    throw new ErrorPeticion(
      400,
      "La duración debe ser un entero entre 1 y 86400 segundos.",
    );
  return { solicitudId, nombreArchivo: nombre, duracionSegundos };
}

/** Administra una captura independiente y conserva su resultado en el disco local. */
export class GestorLecturas {
  private registros = new Map<string, Captura>();
  private procesos = new Map<string, ChildProcessWithoutNullStreams>();
  private pendientesSalida = new Set<string>();
  private fallos = new Map<string, string>();
  private directorioEstado: string;
  private vigilancia: ReturnType<typeof setInterval>;
  private cerrando = false;

  constructor(public configuracion: Configuracion) {
    configuracion.directorioDatos = resolve(configuracion.directorioDatos);
    mkdirSync(configuracion.directorioDatos, { recursive: true });
    this.directorioEstado = join(configuracion.directorioDatos, ".lecturas");
    mkdirSync(this.directorioEstado, { recursive: true });
    for (const archivo of readdirSync(this.directorioEstado).filter((nombre) =>
      /^[\w-]+\.json$/.test(nombre),
    )) {
      const captura = JSON.parse(
        readFileSync(join(this.directorioEstado, archivo), "utf8"),
      ) as Captura;
      if (
        !captura.id ||
        archivo !== `${captura.id}.json` ||
        !/^[\w-]+$/.test(captura.id) ||
        captura.archivo !== captura.archivo.split(/[\\/]/).pop()
      )
        throw new Error("Metadatos de captura inválidos.");
      this.registros.set(captura.id, captura);
    }
    this.actualizar();
    this.vigilancia = setInterval(() => this.actualizar(), 500);
    this.vigilancia.unref();
  }

  private rutaEstado(id: string) {
    return join(this.directorioEstado, `${id}.estado.json`);
  }
  private rutaParada(id: string) {
    return join(this.directorioEstado, `${id}.detener`);
  }
  private guardar(captura: Captura) {
    const ruta = join(this.directorioEstado, `${captura.id}.json`);
    writeFileSync(`${ruta}.tmp`, JSON.stringify(captura, null, 2), {
      encoding: "utf8",
    });
    renameSync(`${ruta}.tmp`, ruta);
  }

  private aplicar(captura: Captura, evento: EventoPython) {
    const estados = [
      "iniciando",
      "grabando",
      "cerrando",
      "completada",
      "detenida",
      "error",
    ];
    if (!estados.includes(evento.estado)) return;
    Object.assign(captura, evento);
    // La API no habilita otra captura hasta que el hijo termine realmente.
    if (!capturaActiva(captura) && this.pendientesSalida.has(captura.id))
      return;
    this.guardar(captura);
  }

  /** Recupera eventos del hijo incluso si el backend se reinició mientras grababa. */
  private actualizar() {
    for (const captura of this.registros.values()) {
      if (!capturaActiva(captura) && !this.pendientesSalida.has(captura.id))
        continue;
      const ruta = this.rutaEstado(captura.id);
      if (existsSync(ruta)) {
        try {
          this.aplicar(
            captura,
            JSON.parse(readFileSync(ruta, "utf8")) as EventoPython,
          );
        } catch (error) {
          this.fallos.set(
            captura.id,
            `No se pudo leer el estado de Python: ${String(error)}`,
          );
        }
      }
      if (!this.procesos.has(captura.id) && capturaActiva(captura)) {
        let vivo = false;
        if (captura.pid) {
          try {
            process.kill(captura.pid, 0);
            vivo = true;
          } catch {
            /* El proceso ya no existe. */
          }
        }
        // Una interrupción puede ocurrir antes de guardar el PID del hijo.
        // Da tiempo a que Python publique su primer evento de disponibilidad.
        if (!vivo && Date.now() - Date.parse(captura.creadaUtc) > 5000) {
          captura.estado = "error";
          captura.finUtc = new Date().toISOString();
          captura.error =
            "El receptor se interrumpió. El CSV existente se conserva como parcial.";
          this.guardar(captura);
        }
      }
    }
  }

  listar() {
    this.actualizar();
    return [...this.registros.values()].sort((a, b) =>
      b.creadaUtc.localeCompare(a.creadaUtc),
    );
  }
  actual() {
    return (
      this.listar().find(
        (captura) =>
          capturaActiva(captura) || this.pendientesSalida.has(captura.id),
      ) ?? null
    );
  }
  obtener(id: string) {
    this.actualizar();
    const captura = this.registros.get(id);
    if (!captura) throw new ErrorPeticion(404, "No se encontró la captura.");
    return this.presentar(captura);
  }
  porSolicitud(id: string) {
    const captura = this.listar().find((captura) => captura.solicitudId === id);
    if (!captura)
      throw new ErrorPeticion(404, "La solicitud todavía no creó una captura.");
    return this.presentar(captura);
  }
  presentar(captura: Captura): Captura {
    return {
      ...captura,
      estado:
        !capturaActiva(captura) && this.pendientesSalida.has(captura.id)
          ? "cerrando"
          : captura.estado,
    };
  }

  /** Inicia Python sin shell y reserva un nombre que no sobrescriba otras capturas. */
  iniciar(carga: unknown): Captura {
    const solicitud = validarSolicitud(carga);
    const anterior = this.listar().find(
      (captura) => captura.solicitudId === solicitud.solicitudId,
    );
    if (anterior) {
      if (
        anterior.nombreArchivo !== solicitud.nombreArchivo ||
        anterior.duracionSegundos !== solicitud.duracionSegundos
      )
        throw new ErrorPeticion(
          409,
          "Esta solicitud ya fue utilizada con otros parámetros.",
        );
      return this.presentar(anterior);
    }
    if (this.cerrando)
      throw new ErrorPeticion(503, "El backend se está cerrando.");
    if (this.actual())
      throw new ErrorPeticion(
        409,
        "Ya hay una captura activa. Espera a que cierre su CSV.",
      );
    const fecha = new Date();
    const base = `${solicitud.nombreArchivo}_${fechaArchivo(fecha, this.configuracion.zonaHoraria)}`;
    let archivo = `${base}.csv`,
      sufijo = 2;
    while (
      existsSync(join(this.configuracion.directorioDatos, archivo)) ||
      [...this.registros.values()].some(
        (captura) => captura.archivo === archivo,
      )
    )
      archivo = `${base}_${sufijo++}.csv`;
    const captura: Captura = {
      ...solicitud,
      id: randomUUID(),
      archivo,
      estado: "iniciando",
      creadaUtc: fecha.toISOString(),
      inicioUtc: null,
      finPrevistoUtc: null,
      finUtc: null,
      filasEscritas: 0,
      ultimaRecepcionUtc: null,
      error: null,
      pid: null,
    };
    this.registros.set(captura.id, captura);
    this.guardar(captura);
    const cfg = this.configuracion;
    const argumentos = [
      "-u",
      join(cfg.raiz, "python/receptor_gateway.py"),
      "--archivo",
      join(cfg.directorioDatos, archivo),
      "--host",
      cfg.host,
      "--puerto-http",
      String(cfg.puertoHttp),
      "--destino-udp",
      cfg.destinoUdp,
      "--puerto-udp",
      String(cfg.puertoUdp),
      "--duracion",
      String(solicitud.duracionSegundos),
      "--control-json",
      "--sin-anuncio-udp",
      "--nuevo",
      "--estado-json",
      this.rutaEstado(captura.id),
      "--detener-archivo",
      this.rutaParada(captura.id),
    ];
    const hijo = spawn(cfg.python, argumentos, {
      cwd: cfg.raiz,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    captura.pid = hijo.pid ?? null;
    this.procesos.set(captura.id, hijo);
    this.pendientesSalida.add(captura.id);
    this.guardar(captura);
    let salidaError = "";
    hijo.stderr.on("data", (datos) => {
      salidaError = (salidaError + datos.toString()).slice(-4000);
    });
    hijo.stdin.on("error", () => {
      /* El archivo de parada permite cerrar aunque falle la tubería. */
    });
    const lineas = createInterface({ input: hijo.stdout });
    lineas.on("line", (linea) => {
      try {
        this.aplicar(captura, JSON.parse(linea) as EventoPython);
      } catch {
        /* Solo se interpretan eventos JSON del modo de control. */
      }
    });
    hijo.on("error", (error) => {
      this.fallos.set(
        captura.id,
        `No se pudo iniciar Python: ${error.message}`,
      );
    });
    hijo.on("close", (codigo) => {
      lineas.close();
      this.procesos.delete(captura.id);
      this.pendientesSalida.delete(captura.id);
      if (codigo !== 0 || capturaActiva(captura)) {
        captura.estado = "error";
        captura.error =
          this.fallos.get(captura.id) ??
          captura.error ??
          (salidaError.trim() ||
            "El receptor terminó sin confirmar el cierre del CSV.");
        captura.finUtc = new Date().toISOString();
      }
      this.guardar(captura);
    });
    return this.presentar(captura);
  }

  detener(id: string): Captura {
    const captura = this.registros.get(id);
    if (!captura) throw new ErrorPeticion(404, "No se encontró la captura.");
    if (!capturaActiva(captura)) return this.presentar(captura);
    writeFileSync(this.rutaParada(id), "detener\n");
    this.procesos.get(id)?.stdin.write("detener\n");
    captura.estado = "cerrando";
    this.guardar(captura);
    return this.presentar(captura);
  }

  rutaDescarga(id: string) {
    const captura = this.obtener(id);
    if (capturaActiva(captura))
      throw new ErrorPeticion(
        409,
        "Espera a que el archivo termine de cerrarse.",
      );
    const ruta = join(this.configuracion.directorioDatos, captura.archivo);
    if (!existsSync(ruta))
      throw new ErrorPeticion(404, "Esta captura no llegó a crear un CSV.");
    return { ruta, nombre: captura.archivo };
  }

  /** Solicita cierre ordenado; el plazo propio de Python protege capturas interrumpidas. */
  async cerrar() {
    this.cerrando = true;
    clearInterval(this.vigilancia);
    const activa = this.actual();
    if (activa) this.detener(activa.id);
    const plazo = Date.now() + 15000;
    while (this.actual() && Date.now() < plazo)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.actual()) {
      const captura = this.actual()!;
      captura.estado = "error";
      captura.error =
        "El cierre excedió el plazo. El CSV se conserva como parcial.";
      captura.finUtc = new Date().toISOString();
      this.procesos.get(captura.id)?.kill("SIGKILL");
      this.guardar(captura);
    }
  }
}
