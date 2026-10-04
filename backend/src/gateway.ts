import { createSocket, type Socket } from "node:dgram";
import type { EstadoGateway, GatewayDetectado } from "../../shared/lecturas.js";

const PREFIJO = "HEATMAP_GATEWAY_V1 ";
const VIGENCIA_MS = 10000;

/** Escucha anuncios del ESP32; la PC solo responde por unicast al emisor. */
export class DescubridorGateway {
  private socket: Socket | null = null;
  private escuchando = false;
  private error: string | null = null;
  private dispositivos = new Map<string, GatewayDetectado>();

  constructor(
    private puertoUdp: number,
    private puertoReceptor: () => number,
  ) {}

  iniciar() {
    if (this.socket) return;
    const socket = createSocket("udp4");
    this.socket = socket;
    socket.on("error", (error) => {
      this.error = `No se pudo escuchar al Gateway en UDP ${this.puertoUdp}: ${error.message}`;
      console.error(this.error);
      this.cerrar();
    });
    socket.on("listening", () => {
      this.escuchando = true;
      this.error = null;
      console.log(`Escuchando anuncios del Gateway en UDP ${this.puertoUdp}`);
    });
    socket.on("message", (mensaje, origen) => {
      if (mensaje.length > 1024 || !mensaje.toString().startsWith(PREFIJO)) return;
      let anuncio: Record<string, unknown>;
      try {
        anuncio = JSON.parse(mensaje.toString().slice(PREFIJO.length));
      } catch { return; }
      if (!anuncio || typeof anuncio !== "object" ||
          typeof anuncio.mac !== "string" ||
          !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(anuncio.mac) ||
          typeof anuncio.pcConfirmada !== "boolean") return;
      const campos = ["sesion", "canal", "uptimeMs", "registrosRecibidos", "registrosEnviados", "fallosHttp"] as const;
      if (campos.some((campo) => !Number.isInteger(anuncio[campo]) ||
          Number(anuncio[campo]) < 0 || Number(anuncio[campo]) > 0xffffffff) ||
          Number(anuncio.sesion) === 0 || Number(anuncio.canal) < 1 ||
          Number(anuncio.canal) > 14) return;
      const mac = anuncio.mac.toUpperCase();
      // Limita los dispositivos recordados, sin acumular emisores indefinidamente.
      if (!this.dispositivos.has(mac) && this.dispositivos.size >= 32)
        this.dispositivos.delete(this.dispositivos.keys().next().value!);
      this.dispositivos.set(mac, {
        mac, ip: origen.address,
        sesion: Number(anuncio.sesion), canal: Number(anuncio.canal),
        uptimeMs: Number(anuncio.uptimeMs),
        registrosRecibidos: Number(anuncio.registrosRecibidos),
        registrosEnviados: Number(anuncio.registrosEnviados),
        fallosHttp: Number(anuncio.fallosHttp),
        pcConfirmada: anuncio.pcConfirmada,
        ultimaVezUtc: new Date().toISOString(), conectado: true,
      });
      const puerto = this.puertoReceptor();
      // Puerto cero confirma presencia de la PC, pero no autoriza enviar registros.
      socket.send(`HEATMAP_PC_V2 ${anuncio.sesion} ${puerto}`, origen.port, origen.address,
        (error) => { if (error) console.error(`Respuesta UDP al Gateway: ${error.message}`); });
    });
    socket.bind(this.puertoUdp, "0.0.0.0");
  }

  estado(): EstadoGateway {
    return {
      escuchando: this.escuchando, error: this.error,
      dispositivos: [...this.dispositivos.values()].map((dispositivo) => ({
        ...dispositivo,
        conectado: this.escuchando && Date.now() - Date.parse(dispositivo.ultimaVezUtc) < VIGENCIA_MS,
      })),
    };
  }

  cerrar() {
    this.escuchando = false;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* Puede haber fallado antes de enlazar el puerto. */ }
  }
}
