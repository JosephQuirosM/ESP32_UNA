import { createSocket, type Socket, type RemoteInfo } from "node:dgram";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EstadoGateway, GatewayDetectado } from "../../shared/lecturas.js";

const PREFIJO = "HEATMAP_GATEWAY_V1 ";
const VIGENCIA_MS = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface OrdenControl {
  revision: number;
  capturaId: string;
  puerto: number;
  mac?: string;
  sesion?: number;
}

/** Descubre el Gateway y delimita capturas con órdenes UDP V3 idempotentes. */
export class DescubridorGateway extends EventEmitter {
  private socket: Socket | null = null;
  private escuchando = false;
  private error: string | null = null;
  private dispositivos = new Map<string, GatewayDetectado>();
  private destinos = new Map<string, RemoteInfo>();
  private orden: OrdenControl;
  private confirmada = false;
  private ultimoEnvio = 0;
  private temporizador?: ReturnType<typeof setInterval>;
  private rutaControl: string;

  constructor(private puertoUdp: number, directorioEstado: string) {
    super();
    mkdirSync(directorioEstado, { recursive: true });
    this.rutaControl = join(directorioEstado, ".control-gateway.json");
    this.orden = { revision: Date.now(), capturaId: "-", puerto: 0 };
    if (existsSync(this.rutaControl)) {
      const previo = JSON.parse(readFileSync(this.rutaControl, "utf8")) as OrdenControl;
      if (!Number.isSafeInteger(previo.revision) || previo.revision < 1 ||
          !Number.isInteger(previo.puerto) || previo.puerto < 0 || previo.puerto > 65535 ||
          !(previo.puerto === 0 ? previo.capturaId === "-" : UUID.test(previo.capturaId)))
        throw new Error("Estado persistido del control Gateway inválido.");
      this.orden = previo;
    }
    this.guardar();
  }

  private guardar() {
    writeFileSync(`${this.rutaControl}.tmp`, JSON.stringify(this.orden));
    renameSync(`${this.rutaControl}.tmp`, this.rutaControl);
  }

  /** Recupera la misma revisión al reiniciar; un cambio de captura crea otra. */
  autorizar(capturaId: string, puerto: number) {
    if (!UUID.test(capturaId) || !Number.isInteger(puerto) || puerto < 1 || puerto > 65535)
      throw new Error("Autorización de captura inválida.");
    if (this.orden.capturaId === capturaId && this.orden.puerto === puerto) return;
    this.orden = { revision: Math.max(Date.now(), this.orden.revision + 1), capturaId, puerto };
    this.confirmada = false;
    this.ultimoEnvio = 0;
    this.guardar();
    this.enviar();
  }

  desactivar() {
    if (this.orden.puerto === 0) return;
    this.orden = { revision: Math.max(Date.now(), this.orden.revision + 1), capturaId: "-", puerto: 0 };
    this.confirmada = false;
    this.ultimoEnvio = 0;
    this.guardar();
    this.enviar();
  }

  iniciar() {
    if (this.socket) return;
    const socket = createSocket("udp4");
    this.socket = socket;
    socket.on("error", (error) => {
      this.error = `No se pudo escuchar al Gateway en UDP ${this.puertoUdp}: ${error.message}`;
      this.emit("fallo", this.orden.capturaId, this.error);
      this.cerrar();
    });
    socket.on("listening", () => {
      this.escuchando = true;
      this.error = null;
      this.temporizador = setInterval(() => this.enviar(), 250);
      this.temporizador.unref();
      console.log(`Control de capturas Gateway en UDP ${(socket.address() as { port: number }).port}`);
    });
    socket.on("message", (mensaje, origen) => this.recibir(mensaje, origen));
    socket.bind(this.puertoUdp, "0.0.0.0");
  }

  private recibir(mensaje: Buffer, origen: RemoteInfo) {
    if (mensaje.length > 1024) return;
    const texto = mensaje.toString();
    const ack = /^HEATMAP_ACK_V3 (\d+) (\d+) ([0-9a-f-]+) (\d+)$/.exec(texto);
    if (ack) {
      const destino = this.orden.mac ? this.destinos.get(this.orden.mac) :
        [...this.destinos.values()].find(d => d.address === origen.address && d.port === origen.port);
      if (!destino || destino.address !== origen.address || destino.port !== origen.port ||
          Number(ack[2]) !== this.orden.revision || ack[3] !== this.orden.capturaId) return;
      const dispositivo = [...this.dispositivos.values()].find(d => d.ip === origen.address &&
        this.destinos.get(d.mac)?.port === origen.port && d.sesion === Number(ack[1]));
      if (!dispositivo || (this.orden.sesion && this.orden.sesion !== Number(ack[1]))) return;
      if (Number(ack[4]) !== this.orden.puerto) {
        if (this.orden.puerto !== 0) this.emit("fallo", this.orden.capturaId, "La autorización del Gateway venció o fue cerrada. El CSV se conserva como parcial.");
        return;
      }
      if (!this.confirmada) {
        this.confirmada = true;
        this.emit("confirmacion", this.orden.capturaId, dispositivo);
      }
      return;
    }
    if (!texto.startsWith(PREFIJO)) return;
    let anuncio: Record<string, unknown>;
    try { anuncio = JSON.parse(texto.slice(PREFIJO.length)); } catch { return; }
    if (!anuncio || typeof anuncio !== "object" || typeof anuncio.mac !== "string" ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(anuncio.mac) || typeof anuncio.pcConfirmada !== "boolean") return;
    const campos = ["sesion", "canal", "uptimeMs", "registrosRecibidos", "registrosEnviados", "fallosHttp"] as const;
    if (campos.some(c => !Number.isInteger(anuncio[c]) || Number(anuncio[c]) < 0 || Number(anuncio[c]) > 0xffffffff) ||
        Number(anuncio.sesion) === 0 || Number(anuncio.canal) < 1 || Number(anuncio.canal) > 14) return;
    const mac = anuncio.mac.toUpperCase();
    const controlCaptura = anuncio.controlCaptura === 1;
    if (controlCaptura && (!Number.isSafeInteger(anuncio.revisionControl) || Number(anuncio.revisionControl) < 0)) return;
    if (!this.dispositivos.has(mac) && this.dispositivos.size >= 32) {
      const primero = this.dispositivos.keys().next().value!;
      this.dispositivos.delete(primero); this.destinos.delete(primero);
    }
    this.destinos.set(mac, origen);
    this.dispositivos.set(mac, {
      mac, ip: origen.address, sesion: Number(anuncio.sesion), canal: Number(anuncio.canal),
      uptimeMs: Number(anuncio.uptimeMs), registrosRecibidos: Number(anuncio.registrosRecibidos),
      registrosEnviados: Number(anuncio.registrosEnviados), fallosHttp: Number(anuncio.fallosHttp),
      pcConfirmada: anuncio.pcConfirmada, ultimaVezUtc: new Date().toISOString(), conectado: true,
      controlCaptura, revisionControl: Number(anuncio.revisionControl ?? 0),
      capturando: anuncio.capturando === true,
      descartesInactivos: Number(anuncio.descartesInactivos ?? 0), registrosPurgados: Number(anuncio.registrosPurgados ?? 0),
    });
    if (this.orden.puerto && this.orden.mac === mac && this.orden.sesion !== Number(anuncio.sesion)) {
      this.emit("fallo", this.orden.capturaId, "El Gateway se reinició durante la captura. Inicia un archivo nuevo.");
      return;
    }
    if (controlCaptura && Number(anuncio.revisionControl) > this.orden.revision) {
      if (this.orden.puerto) {
        this.emit("fallo", this.orden.capturaId, "Otro control reemplazó la autorización del Gateway.");
        return;
      }
      this.orden.revision = Number(anuncio.revisionControl) + 1;
      this.guardar();
    }
    this.enviar(true);
  }

  private enviar(inmediato = false) {
    if (!this.socket || !this.escuchando ||
        (!inmediato && Date.now() - this.ultimoEnvio < (this.confirmada ? 2000 : 250))) return;
    const conectados = this.estado().dispositivos.filter(d => d.conectado);
    if (this.orden.puerto && !this.orden.mac) {
      const elegido = conectados.find(d => d.controlCaptura);
      if (elegido) {
        this.orden.mac = elegido.mac; this.orden.sesion = elegido.sesion; this.guardar();
      } else if (conectados.length) {
        this.emit("fallo", this.orden.capturaId, "Actualiza el firmware del Gateway: no admite control de capturas.");
        return;
      }
    }
    for (const dispositivo of conectados) {
      if (!dispositivo.controlCaptura || (this.orden.puerto && dispositivo.mac !== this.orden.mac)) continue;
      const destino = this.destinos.get(dispositivo.mac)!;
      const mensaje = `HEATMAP_PC_V3 ${dispositivo.sesion} ${this.orden.revision} ${this.orden.capturaId} ${this.orden.puerto}`;
      this.socket.send(mensaje, destino.port, destino.address, error => {
        if (error) console.error(`Control UDP del Gateway: ${error.message}`);
      });
    }
    this.ultimoEnvio = Date.now();
  }

  estado(): EstadoGateway {
    return { escuchando: this.escuchando, error: this.error,
      dispositivos: [...this.dispositivos.values()].map(d => ({ ...d,
        conectado: this.escuchando && Date.now() - Date.parse(d.ultimaVezUtc) < VIGENCIA_MS,
      })),
    };
  }

  cerrar() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.escuchando = false;
    const socket = this.socket; this.socket = null;
    try { socket?.close(); } catch { /* Fallo antes de enlazar el puerto. */ }
  }
}
